const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { once } = require("node:events");
const { createBackend } = require("../../Electron/backend-dist/server.js");

const repoRoot = resolve(__dirname, "..", "..");
const serverPath = resolve(repoRoot, "mcp", "forgelink-human", "dist", "server.js");

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

function parseToolText(response) {
  const text = response?.result?.content?.[0]?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

function toFabricManifest(serverId, listed) {
  return {
    schema_version: 1,
    servers: [{
      server_id: serverId,
      tools: listed.tools.result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        input_schema: tool.inputSchema || tool.input_schema || {}
      })),
      resources: listed.resources.result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name || "",
        mime_type: resource.mimeType || resource.mime_type || ""
      })),
      prompts: listed.prompts.result.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description || "",
        arguments: prompt.arguments || []
      }))
    }]
  };
}

function capabilityRows(manifest, runnerId) {
  const rows = [];
  for (const server of manifest.servers || []) {
    for (const tool of server.tools || []) rows.push({ runner_id: runnerId, capability_kind: "tool", name: tool.name, source_server: server.server_id });
    for (const resource of server.resources || []) rows.push({ runner_id: runnerId, capability_kind: "resource", name: resource.uri, source_server: server.server_id });
    for (const prompt of server.prompts || []) rows.push({ runner_id: runnerId, capability_kind: "prompt", name: prompt.name, source_server: server.server_id });
  }
  return rows;
}

function manifestHash(manifest) {
  return createHash("sha256").update(JSON.stringify(manifest, Object.keys(manifest).sort())).digest("hex");
}

async function withMcp(baseUrl, tokenFile, run) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORGELINK_BASE_URL: baseUrl,
      FORGELINK_API_TOKEN_FILE: tokenFile,
      FORGELINK_CHANNEL_TOKEN_FILE: join(tokenFile, "..", "forgelink-channel.token"),
      FORGELINK_CHANNEL_ID: "forgewire",
      FORGELINK_SOURCE: "forgewire-fabric"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let nextId = 1;
  const pending = new Map();
  readFrames(child.stdout, (message) => {
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  const call = (method, params = {}) => new Promise((resolveCall) => {
    const id = nextId++;
    pending.set(id, resolveCall);
    child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
  });
  try {
    await run(call);
  } finally {
    child.kill();
    await once(child, "exit").catch(() => undefined);
    assert.equal(stderr.join("").trim(), "");
  }
}

async function backendJson(baseUrl, token, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${path} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const port = 5600 + Math.floor(Math.random() * 500);
  const dataDir = await mkdtemp(join(tmpdir(), "forgelink-fabric-smoke-"));
  const launchToken = `launch_${randomBytes(24).toString("base64url")}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  const { server } = createBackend({ host: "127.0.0.1", port, dataDir, apiToken: launchToken });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  try {
    const created = await backendJson(baseUrl, launchToken, "/api/mcp/token", { method: "POST" });
    const tokenFile = join(dataDir, "forgelink-mcp.token");
    await writeFile(tokenFile, created.token, { mode: 0o600 });
    const channel = await backendJson(baseUrl, launchToken, "/api/agent-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "forgewire", label: "ForgeWire Fabric" })
    });
    await writeFile(join(dataDir, "forgelink-channel.token"), channel.token, { mode: 0o600 });

    const result = {};
    await withMcp(baseUrl, tokenFile, async (call) => {
      const init = await call("initialize", {});
      assert.equal(init.result.serverInfo.name, "forgelink-human");
      const listed = {
        tools: await call("tools/list"),
        resources: await call("resources/list"),
        prompts: await call("prompts/list")
      };
      const manifest = toFabricManifest("forgelink-human", listed);
      const rows = capabilityRows(manifest, "forgewire-fabric-local-smoke");

      assert.ok(rows.some((row) => row.capability_kind === "tool" && row.name === "request_human_approval"));
      assert.ok(rows.some((row) => row.capability_kind === "tool" && row.name === "record_human_action"));
      assert.ok(rows.some((row) => row.capability_kind === "resource" && row.name === "forgelink://persona"));
      assert.ok(rows.some((row) => row.capability_kind === "prompt" && row.name === "forgelink_request_approval"));

      const approvalId = `fabric-smoke-${Date.now()}`;
      const createdApproval = await call("tools/call", {
        name: "request_human_approval",
        arguments: {
          id: approvalId,
          title: "Fabric smoke approval",
          body: "High-fidelity local smoke verifies ForgeWire Fabric can reach ForgeLink.",
          actions: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
          urgency: "normal"
        }
      });
      assert.equal(createdApproval.error, undefined);
      const message = parseToolText(createdApproval).message;
      assert.equal(message.id, approvalId);
      assert.equal(message.channel_id, "forgewire");
      assert.equal(message.source, "forgewire-fabric");

      const action = await call("tools/call", {
        name: "record_human_action",
        arguments: { id: approvalId, action_id: "approve" }
      });
      assert.equal(action.error, undefined);
      const acted = parseToolText(action).message;
      assert.equal(acted.status, "acted");
      assert.match(acted.action_result, /approve/);

      const observed = await call("tools/call", {
        name: "get_human_message",
        arguments: { id: approvalId }
      });
      const observedMessage = parseToolText(observed);
      assert.equal(observedMessage.status, "acted");

      result.manifest = manifest;
      result.capability_rows = rows;
      result.transcript = {
        created_message_id: approvalId,
        channel_id: message.channel_id,
        source: message.source,
        kind: message.kind,
        urgency: message.urgency,
        action_result: JSON.parse(acted.action_result || "{}")
      };
    });

    const out = {
      schema_version: 1,
      smoke: "forgewire-fabric-forgelink-human",
      result: "passed",
      fabric_manifest_hash: manifestHash(result.manifest),
      fabric_manifest: result.manifest,
      capability_rows: result.capability_rows,
      transcript: result.transcript,
      redaction_note: "Token values and message body text are omitted from this smoke output."
    };
    const outputDir = resolve(repoRoot, "evidence", "artifacts");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, "20260615-forgewire-fabric-smoke.json");
    await writeFile(outputPath, `${JSON.stringify(out, null, 2)}\n`);
    console.log(outputPath);
  } finally {
    server.close();
    await once(server, "close").catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
