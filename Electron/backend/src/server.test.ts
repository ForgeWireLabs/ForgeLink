import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AddressInfo } from "node:net";
import { createBackend } from "./server";

const apiToken = "local-api-test-token";
const authorized = (headers: HeadersInit = {}): HeadersInit => ({ ...headers, Authorization: `Bearer ${apiToken}` });
async function createChannel(localUrl: string, channel_id = "forgewire"): Promise<string> {
  const response = await fetch(`${localUrl}/api/agent-channels`, {
    method: "POST",
    headers: authorized({ "Content-Type": "application/json" }),
    body: JSON.stringify({ channel_id, label: channel_id })
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { token: string }).token;
}

function signature(baseUrl: string, pathname: string, fields: Record<string, string>, token: string): string {
  const value = `${baseUrl}${pathname}${Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join("")}`;
  return createHmac("sha1", token).update(value).digest("base64");
}

test("serves health and contact HTTP contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-http-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: "Bearer wrong-token" } })).status, 401);

    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: authorized() });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, runtime: "node" });

    const saved = await fetch(`http://127.0.0.1:${port}/api/contacts`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Ada", number: "+15551234567" })
    });
    assert.equal(saved.status, 200);
    const contacts = await fetch(`http://127.0.0.1:${port}/api/contacts`, { headers: authorized() }).then((response) => response.json()) as Array<Record<string, unknown>>;
    assert.equal(contacts[0].name, "Ada");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserves webhook, status, upload, and media HTTP contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-parity-"));
  const previous = {
    authToken: process.env.TWILIO_AUTH_TOKEN,
    publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL
  };
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  const publicUrl = "https://phone.example.com";
  process.env.TWILIO_PUBLIC_BASE_URL = publicUrl;
  try {
    const inbound = { From: "+15551234567", Body: "Inbound hello", MessageSid: "SM-IN", NumMedia: "1", MediaUrl0: "https://api.twilio.com/media/photo.jpg" };
    const rejected = await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" }, body: new URLSearchParams(inbound) });
    assert.equal(rejected.status, 403);

    const accepted = await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(publicUrl, "/webhooks/sms", inbound, "test-token") }, body: new URLSearchParams(inbound) });
    assert.equal(accepted.status, 200);
    const thread = database.threads()[0];
    const stored = database.messages(thread.id)[0];
    assert.equal(stored.body, "Inbound hello");
    assert.equal(stored.media_urls, "https://api.twilio.com/media/photo.jpg");

    const statusFields = { MessageSid: "SM-IN", MessageStatus: "delivered" };
    const statusResponse = await fetch(`${localUrl}/webhooks/status`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(publicUrl, "/webhooks/status", statusFields, "test-token") }, body: new URLSearchParams(statusFields) });
    assert.equal(statusResponse.status, 200);
    assert.equal(database.messages(thread.id)[0].status, "delivered");

    const form = new FormData();
    form.append("file", new File(["image-data"], "photo.png", { type: "image/png" }));
    const uploaded = await fetch(`${localUrl}/upload`, { method: "POST", headers: authorized(), body: form });
    assert.equal(uploaded.status, 200);
    const uploadedPayload = await uploaded.json() as { url: string };
    assert.match(uploadedPayload.url, /^https:\/\/phone\.example\.com\/media\/[A-Za-z0-9_-]+\.png$/);
    const mediaPath = new URL(uploadedPayload.url).pathname;
    const media = await fetch(`${localUrl}${mediaPath}`);
    assert.equal(media.status, 200);
    assert.equal(await media.text(), "image-data");

    const invalidForm = new FormData();
    invalidForm.append("file", new File(["bad"], "script.exe"));
    assert.equal((await fetch(`${localUrl}/upload`, { method: "POST", headers: authorized(), body: invalidForm })).status, 400);
    assert.equal((await fetch(`${localUrl}/media/../phone.sqlite3`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous.authToken;
    if (previous.publicBaseUrl === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previous.publicBaseUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backs up, exports, restores, and reports managed data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-data-api-"));
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    database.upsertContact("Before backup", "+15551234567");
    mkdirSync(join(directory, "uploads"), { recursive: true });
    writeFileSync(join(directory, "uploads", "proof.txt"), "before backup");
    const backedUp = await fetch(`${localUrl}/api/data/backup`, { method: "POST", headers: authorized() });
    assert.equal(backedUp.status, 200);
    database.upsertContact("After backup", "+15557654321");
    writeFileSync(join(directory, "uploads", "proof.txt"), "after backup");

    const exported = await fetch(`${localUrl}/api/data/export`, { method: "POST", headers: authorized() });
    assert.equal(exported.status, 200);
    const exportName = ((await exported.json()) as { name: string }).name;
    assert.match(exportName, /^export-.*\.json$/);

    const restored = await fetch(`${localUrl}/api/data/restore-latest`, { method: "POST", headers: authorized() });
    assert.equal(restored.status, 200);
    assert.deepEqual(database.contacts().map((contact) => contact.name), ["Before backup"]);
    assert.equal(readFileSync(join(directory, "uploads", "proof.txt"), "utf8"), "before backup");

    const status = await fetch(`${localUrl}/api/data/status`, { headers: authorized() }).then((response) => response.json()) as { schema_version: number; backup_count: number; latest_backup: string };
    assert.equal(status.schema_version, 7);
    assert.equal(status.backup_count, 1);
    assert.match(status.latest_backup, /^backup-/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manages trusted signal subscriptions, bounded refresh, archive, and failed fetch status", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-signals-api-"));
  const feedServer = createServer((request, response) => {
    if (request.url === "/feed.xml") {
      const body = `<rss><channel><title>Forge Signals</title><item><guid>one</guid><title>Build note</title><link>http://example.test/build</link><description>Release candidate ready</description><pubDate>Mon, 15 Jun 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
      response.writeHead(200, { "Content-Type": "application/rss+xml", "Content-Length": Buffer.byteLength(body) });
      return response.end(body);
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<html>not a feed</html>");
  });
  await new Promise<void>((resolve) => feedServer.listen(0, "127.0.0.1", resolve));
  const feedPort = (feedServer.address() as AddressInfo).port;
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const created = await fetch(`${localUrl}/api/signals/subscriptions`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url: `http://127.0.0.1:${feedPort}/feed.xml`, fetch_interval_minutes: 15, retention_days: 7 })
    });
    assert.equal(created.status, 201);
    const subscriptionId = ((await created.json()) as { subscription: { id: string } }).subscription.id;

    const refreshed = await fetch(`${localUrl}/api/signals/subscriptions/${subscriptionId}/refresh`, { method: "POST", headers: authorized() });
    assert.equal(refreshed.status, 200);
    const refreshedPayload = await refreshed.json() as { added: number; subscription: { title: string; last_fetch_status: string }; items: Array<{ id: string; title: string }> };
    assert.equal(refreshedPayload.added, 1);
    assert.equal(refreshedPayload.subscription.title, "Forge Signals");
    assert.equal(refreshedPayload.subscription.last_fetch_status, "ok");
    assert.equal(refreshedPayload.items[0].title, "Build note");

    assert.equal((await fetch(`${localUrl}/api/signals/subscriptions/${subscriptionId}/mute`, { method: "POST", headers: authorized() })).status, 200);
    const archived = await fetch(`${localUrl}/api/signals/items/${refreshedPayload.items[0].id}/archive`, { method: "POST", headers: authorized() });
    assert.equal(archived.status, 200);
    const listed = await fetch(`${localUrl}/api/signals/items`, { headers: authorized() }).then((response) => response.json()) as Array<unknown>;
    assert.equal(listed.length, 0);

    const bad = await fetch(`${localUrl}/api/signals/subscriptions`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url: `http://127.0.0.1:${feedPort}/bad.html` })
    }).then((response) => response.json()) as { subscription: { id: string } };
    const failed = await fetch(`${localUrl}/api/signals/subscriptions/${bad.subscription.id}/refresh`, { method: "POST", headers: authorized() });
    assert.equal(failed.status, 400);
    const subscriptions = await fetch(`${localUrl}/api/signals/subscriptions`, { headers: authorized() }).then((response) => response.json()) as Array<{ id: string; last_fetch_status: string; last_error: string }>;
    assert.equal(subscriptions.find((item) => item.id === bad.subscription.id)?.last_fetch_status, "failed");
    assert.match(subscriptions.find((item) => item.id === bad.subscription.id)?.last_error || "", /content type|readable/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => feedServer.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manages MCP token and restricts it to agent-safe routes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-mcp-token-api-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const created = await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() });
    assert.equal(created.status, 200);
    const createdPayload = await created.json() as { token: string; status: { configured: boolean } };
    assert.match(createdPayload.token, /^flmcp_/);
    assert.equal(createdPayload.status.configured, true);
    const mcpHeaders = { Authorization: `Bearer ${createdPayload.token}`, "Content-Type": "application/json" };
    const channelToken = await createChannel(localUrl);

    assert.equal((await fetch(`${localUrl}/api/contacts`, { headers: mcpHeaders })).status, 401);
    assert.equal((await fetch(`${localUrl}/api/data/export`, { method: "POST", headers: mcpHeaders })).status, 401);
    assert.equal((await fetch(`${localUrl}/health`, { headers: mcpHeaders })).status, 200);
    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: mcpHeaders, body: "{}" })).status, 401);

    const posted = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { ...mcpHeaders, "X-ForgeLink-Channel-Token": channelToken },
      body: JSON.stringify({ source: "codex", kind: "approval_request", urgency: "normal", title: "MCP approval", body: "Need approval", actions: [{ id: "approve", label: "Approve" }] })
    });
    assert.equal(posted.status, 201);
    const listed = await fetch(`${localUrl}/api/agent-messages`, { headers: mcpHeaders }).then((response) => response.json()) as Array<{ title: string }>;
    assert.equal(listed[0].title, "MCP approval");

    const revoked = await fetch(`${localUrl}/api/mcp/token/revoke`, { method: "POST", headers: authorized() });
    assert.equal(revoked.status, 200);
    assert.equal((await fetch(`${localUrl}/health`, { headers: mcpHeaders })).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts authenticated agent channel messages and records human actions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-agent-api-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const unauthorized = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    const token = await createChannel(localUrl);

    const created = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token },
      body: JSON.stringify({
        id: "agent-http-1",
        source: "forgewire",
        kind: "approval_request",
        urgency: "normal",
        title: "Task needs approval",
        body: "ForgeWire wants to run a release workflow.",
        actions: [{ id: "approve", label: "Approve" }],
        expires_at: "2099-01-01T00:00:00.000Z"
      })
    });
    assert.equal(created.status, 201);
    const listed = await fetch(`${localUrl}/api/agent-messages`, { headers: authorized() }).then((response) => response.json()) as Array<{ id: string; status: string }>;
    assert.deepEqual(listed.map((message) => message.id), ["agent-http-1"]);
    assert.equal(listed[0].status, "unread");

    const acted = await fetch(`${localUrl}/api/agent-messages/agent-http-1/actions/approve`, { method: "POST", headers: authorized() });
    assert.equal(acted.status, 200);
    const actedPayload = await acted.json() as { message: { status: string; action_result: string } };
    assert.equal(actedPayload.message.status, "acted");
    assert.match(actedPayload.message.action_result, /approve/);

    const invalid = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ source: "forgewire", kind: "alert", urgency: "loud", title: "Bad", body: "Bad" }) });
    assert.equal(invalid.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("enforces agent channel credentials, revocation, disable, and urgency rate limits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-agent-channel-security-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  const message = (id: string, urgency = "urgent") => JSON.stringify({ id, source: "forgewire", kind: "approval_request", urgency, title: `Approval ${id}`, body: "Need approval", actions: [{ id: "approve", label: "Approve" }] });
  try {
    const token = await createChannel(localUrl);
    const headers = { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token };
    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": "wrong" }, body: message("bad") })).status, 401);
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers, body: message(`urgent-${index}`) })).status, 201);
    }
    const limited = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers, body: message("urgent-limited") });
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "Rate limit exceeded", channel_id: "forgewire", urgency: "urgent", limit: 3, retry_after_seconds: 60 });
    let channels = await fetch(`${localUrl}/api/agent-channels`, { headers: authorized() }).then((response) => response.json()) as Array<{ rate_limited_count: number; rejection_count: number }>;
    assert.equal(channels[0].rate_limited_count, 1);
    assert.ok(channels[0].rejection_count >= 2);

    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/disable`, { method: "POST", headers: authorized() })).status, 200);
    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers, body: message("disabled", "low") })).status, 401);
    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/enable`, { method: "POST", headers: authorized() })).status, 200);
    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/revoke`, { method: "POST", headers: authorized() })).status, 200);
    assert.equal((await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers, body: message("revoked", "low") })).status, 401);
    const revokedChannels = await fetch(`${localUrl}/api/agent-channels`, { headers: authorized() }).then((response) => response.json()) as Array<{ configured: boolean; revoked_at: string | null }>;
    assert.equal(revokedChannels[0].configured, false);
    assert.ok(revokedChannels[0].revoked_at);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists failed sends, retries them, and ignores duplicate inbound delivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-send-retry-"));
  const previous = { authToken: process.env.TWILIO_AUTH_TOKEN, publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL };
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example.com";
  let attempt = 0;
  const sendMessage = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("Twilio request timed out.");
    return { sid: "SM-RETRY", status: "queued" };
  };
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken, sendMessage });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const failed = await fetch(`${localUrl}/api/send`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ local_id: "local-retry", to: "+15551234567", body: "Persist me", media_urls: [] }) });
    assert.equal(failed.status, 502);
    const thread = database.threads()[0];
    assert.equal(database.messages(thread.id)[0].status, "failed");
    const duplicate = await fetch(`${localUrl}/api/send`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ local_id: "local-retry", to: "+15551234567", body: "Persist me", media_urls: [] }) });
    assert.equal(duplicate.status, 202);
    assert.equal(attempt, 1);
    const retried = await fetch(`${localUrl}/api/retry`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ id: "local-retry" }) });
    assert.equal(retried.status, 200);
    assert.equal(database.messages(thread.id)[0].attempt_count, 2);

    const inbound = { From: "+15557654321", Body: "Once", MessageSid: "SM-DUP" };
    const inboundHeaders = { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature("https://phone.example.com", "/webhooks/sms", inbound, "test-token") };
    assert.equal((await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: inboundHeaders, body: new URLSearchParams(inbound) })).status, 200);
    assert.equal((await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: inboundHeaders, body: new URLSearchParams(inbound) })).status, 200);
    const inboundThread = database.threads().find((item) => item.canonical_number === "+15557654321")!;
    assert.equal(inboundThread.unread_count, 1);
    assert.equal(database.messages(inboundThread.id).length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous.authToken;
    if (previous.publicBaseUrl === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previous.publicBaseUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("serves redacted diagnostics and never leaks secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-diag-"));
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  const previousVersion = process.env.FORGELINK_APP_VERSION;
  process.env.TWILIO_AUTH_TOKEN = "super-secret-auth-token";
  process.env.FORGELINK_APP_VERSION = "9.9.9";
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/diagnostics`)).status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/api/diagnostics`, { headers: authorized() });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes("super-secret-auth-token"), false);
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.equal(body.runtime, "node");
    assert.equal(typeof body.node_version, "string");
    assert.equal(typeof body.schema_version, "number");
    assert.equal(body.credentials_configured, false);
    assert.equal(body.app_version, "9.9.9");
  } finally {
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previousToken;
    if (previousVersion === undefined) delete process.env.FORGELINK_APP_VERSION; else process.env.FORGELINK_APP_VERSION = previousVersion;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hardens webhook signatures (proxy-aware) and the local API surface", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-sec-"));
  const previous = { authToken: process.env.TWILIO_AUTH_TOKEN, publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL };
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  const publicUrl = "https://phone.example.com";
  process.env.TWILIO_PUBLIC_BASE_URL = publicUrl;
  const inbound = { From: "+15550001111", Body: "ping", MessageSid: "SM-SEC" };
  const post = (sig: string, headers: Record<string, string> = {}, fields = inbound) =>
    fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig, ...headers }, body: new URLSearchParams(fields) });
  try {
    // Proxy-aware: validation uses the configured public URL, not the request Host.
    // A signature a proxy-unaware server would accept (computed against the local URL) is rejected.
    assert.equal((await post(signature(localUrl, "/webhooks/sms", inbound, "test-token"))).status, 403);
    // Hostile forwarding headers do not change the validation base: a correct public-URL signature still passes.
    assert.equal((await post(signature(publicUrl, "/webhooks/sms", inbound, "test-token"), { Host: "evil.example", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http" })).status, 200);
    // ...and a signature forged against the spoofed host is rejected.
    const forged = { ...inbound, MessageSid: "SM-FORGE" };
    assert.equal((await post(signature("https://evil.example", "/webhooks/sms", forged, "test-token"), { "X-Forwarded-Host": "evil.example" }, forged)).status, 403);

    // Local API threat surface: private routes require the bearer token.
    for (const path of ["/api/threads", "/api/diagnostics", "/api/contacts"]) {
      assert.equal((await fetch(`${localUrl}${path}`)).status, 401);
    }
    // Path traversal on media is rejected (never 200).
    for (const attempt of ["/media/../server.js", "/media/..%2f..%2fpackage.json", "/media/nested/passwd"]) {
      assert.notEqual((await fetch(`${localUrl}${attempt}`)).status, 200);
    }
    // Config status is redacted: booleans only, never the token value.
    const cfgText = await (await fetch(`${localUrl}/api/config-status`, { headers: authorized() })).text();
    assert.equal(cfgText.includes("test-token"), false);
    assert.equal((JSON.parse(cfgText) as { auth_token: unknown }).auth_token, true);
  } finally {
    if (previous.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous.authToken;
    if (previous.publicBaseUrl === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previous.publicBaseUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exposes local-only channels and a gated companion route (CLV-004/006)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-channels-"));
  const previous = { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, number: process.env.TWILIO_PHONE_NUMBER };
  delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_PHONE_NUMBER;
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const diag = await (await fetch(`${localUrl}/api/diagnostics`, { headers: authorized() })).json() as { local_only: boolean; channels: Array<{ provider: string }>; companion: string };
    assert.equal(diag.local_only, true); // no telecom provider configured
    assert.ok(diag.channels.some((c) => c.provider === "local"));
    assert.ok(diag.channels.some((c) => c.provider === "twilio"));
    assert.equal(diag.companion, "planned");
    // Companion route: authenticated and disabled by default.
    assert.equal((await fetch(`${localUrl}/api/companion/status`)).status, 401);
    const companion = await fetch(`${localUrl}/api/companion/status`, { headers: authorized() });
    assert.equal(companion.status, 503);
    const body = await companion.json() as { enabled: boolean; status: string };
    assert.equal(body.enabled, false);
    assert.equal(body.status, "planned");
  } finally {
    for (const [k, v] of Object.entries({ TWILIO_ACCOUNT_SID: previous.sid, TWILIO_AUTH_TOKEN: previous.token, TWILIO_PHONE_NUMBER: previous.number })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
