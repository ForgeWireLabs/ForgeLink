const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { resolve } = require("node:path");
const test = require("node:test");

function frame(payload) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function readFrames(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      assert.ok(match, `missing Content-Length in ${header}`);
      const length = Number(match[1]);
      const start = headerEnd + 4;
      const end = start + length;
      if (buffer.length < end) return;
      onMessage(JSON.parse(buffer.subarray(start, end).toString("utf8")));
      buffer = buffer.subarray(end);
    }
  });
}

async function withFakeForgeLink(run) {
  const messages = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const authed = request.headers.authorization === "Bearer test-token";
    const send = (status, payload) => {
      const body = Buffer.from(JSON.stringify(payload));
      response.writeHead(status, { "Content-Type": "application/json", "Content-Length": body.length });
      response.end(body);
    };
    if (!authed) return send(401, { error: "Unauthorized" });
    if (request.method === "GET" && url.pathname === "/health") return send(200, { ok: true });
    if (request.method === "GET" && url.pathname === "/api/agent-messages") return send(200, messages);
    const create = url.pathname.match(/^\/api\/agent-channels\/([^/]+)\/messages$/);
    if (request.method === "POST" && create) {
      if (request.headers["x-forgelink-channel-token"] !== "test-channel-token") return send(401, { error: "Unauthorized agent channel credential" });
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const payload = JSON.parse(raw);
      const message = {
        id: payload.id || `agent-${messages.length + 1}`,
        channel_id: decodeURIComponent(create[1]),
        source: payload.source,
        kind: payload.kind,
        urgency: payload.urgency,
        title: payload.title,
        body: payload.body,
        actions: JSON.stringify(payload.actions || []),
        status: "unread",
        action_result: "",
        created_at: "2026-06-15T22:00:00.000Z",
        expires_at: payload.expires_at || null
      };
      messages.unshift(message);
      return send(201, { ok: true, message });
    }
    const action = url.pathname.match(/^\/api\/agent-messages\/([^/]+)\/actions\/([^/]+)$/);
    if (request.method === "POST" && action) {
      const message = messages.find((item) => item.id === decodeURIComponent(action[1]));
      if (!message) return send(404, { error: "Not found" });
      message.status = "acted";
      message.action_result = JSON.stringify({ action_id: decodeURIComponent(action[2]) });
      return send(200, { ok: true, message });
    }
    const dismiss = url.pathname.match(/^\/api\/agent-messages\/([^/]+)\/dismiss$/);
    if (request.method === "POST" && dismiss) {
      const message = messages.find((item) => item.id === decodeURIComponent(dismiss[1]));
      if (!message) return send(404, { error: "Not found" });
      message.status = "dismissed";
      return send(200, { ok: true, message });
    }
    return send(404, { error: "Not found" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = server.address().port;
    await run(`http://127.0.0.1:${port}`, messages);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function withMcp(baseUrl, run) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      FORGELINK_BASE_URL: baseUrl,
      FORGELINK_API_TOKEN: "test-token",
      FORGELINK_CHANNEL_TOKEN: "test-channel-token",
      FORGELINK_CHANNEL_ID: "forgewire",
      FORGELINK_SOURCE: "forgewire-fabric"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = new Map();
  readFrames(child.stdout, (message) => {
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  });
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = pending.size + 1 + Math.floor(Math.random() * 100000);
    pending.set(id, resolve);
    child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
  });
  try {
    await run(call);
  } finally {
    child.kill();
  }
}

test("lists ForgeLink MCP tools, resources, and prompts", async () => {
  await withFakeForgeLink(async (baseUrl) => {
    await withMcp(baseUrl, async (call) => {
      const init = await call("initialize", {});
      assert.equal(init.result.serverInfo.name, "forgelink-human");
      const tools = await call("tools/list");
      assert.ok(tools.result.tools.some((tool) => tool.name === "request_human_approval"));
      const resources = await call("resources/list");
      assert.ok(resources.result.resources.some((resource) => resource.uri === "forgelink://persona"));
      const prompt = await call("prompts/get", { name: "forgelink_ask_human", arguments: { question: "Approve release?" } });
      assert.match(prompt.result.messages[0].content.text, /private human boundary/);
    });
  });
});

test("creates and acts on a ForgeLink human approval through MCP", async () => {
  await withFakeForgeLink(async (baseUrl, messages) => {
    await withMcp(baseUrl, async (call) => {
      const created = await call("tools/call", {
        name: "request_human_approval",
        arguments: {
          id: "mcp-approval-1",
          title: "Release approval",
          body: "ForgeWire wants to publish a release.",
          actions: [{ id: "approve", label: "Approve" }]
        }
      });
      assert.equal(created.error, undefined);
      assert.equal(messages[0].channel_id, "forgewire");
      assert.equal(messages[0].source, "forgewire-fabric");

      const acted = await call("tools/call", {
        name: "record_human_action",
        arguments: { id: "mcp-approval-1", action_id: "approve" }
      });
      assert.equal(acted.error, undefined);
      assert.equal(messages[0].status, "acted");
      assert.match(messages[0].action_result, /approve/);

      const status = await call("tools/call", { name: "channel_status", arguments: {} });
      assert.match(status.result.content[0].text, /"acted": 1/);
    });
  });
});
