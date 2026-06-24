import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AddressInfo } from "node:net";
import { CURRENT_SCHEMA_VERSION } from "./database";
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

function approvalRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const source = String(overrides.source || "forgewire");
  const title = String(overrides.title || "Release approval");
  const actions = overrides.actions || [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }];
  return {
    source,
    kind: "approval_request",
    urgency: "normal",
    title,
    body: String(overrides.body || "A governed action needs approval."),
    intent: String(overrides.intent || title),
    requested_action: String(overrides.requested_action || "Run the requested governed action."),
    reason_for_interrupt: String(overrides.reason_for_interrupt || "The agent cannot proceed without operator approval."),
    risk: String(overrides.risk || "normal"),
    required_authority: String(overrides.required_authority || "general_approval"),
    to_human: String(overrides.to_human || "operator:primary"),
    affected_resources: overrides.affected_resources || [`agent:${source}`],
    expires_at: String(overrides.expires_at || "2099-01-01T00:00:00.000Z"),
    timeout_behavior: String(overrides.timeout_behavior || "deny_on_timeout"),
    deny_behavior: String(overrides.deny_behavior || "do_not_run"),
    expected_response_time: String(overrides.expected_response_time || "15 minutes"),
    no_response_behavior: String(overrides.no_response_behavior || "deny_on_timeout"),
    can_batch: overrides.can_batch ?? false,
    can_wait_until: overrides.can_wait_until,
    decision_options: overrides.decision_options || actions,
    template_id: String(overrides.template_id || "file_write"),
    evidence_pack: overrides.evidence_pack || {
      summary: "Synthetic approval evidence.",
      affected_resources: overrides.affected_resources || [`agent:${source}`],
      diff_summary: "No private diff included in test evidence.",
      proposed_operation: String(overrides.requested_action || "Run the requested governed action."),
      checks: ["synthetic fixture"],
      rollback_plan: "Do not run the action.",
      links: ["local://synthetic-evidence"],
      limitations: "Synthetic test evidence only.",
      redaction_profile: "desktop_full"
    },
    actions,
    ...overrides
  };
}

function signature(baseUrl: string, pathname: string, fields: Record<string, string>, token: string): string {
  const value = `${baseUrl}${pathname}${Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join("")}`;
  return createHmac("sha1", token).update(value).digest("base64");
}

test("serves health and contact HTTP contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-http-"));
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  database.createCall({
    localCallId: "call-diagnostic-private",
    providerKind: "voice_edge",
    providerName: "twilio",
    providerCallId: "CA-DIAGNOSTIC-PRIVATE",
    direction: "outbound",
    from: "+15550000000",
    to: "+15551234567",
    status: "failed",
    redactedError: "Provider rejected request: [redacted]"
  });
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
    assert.equal(status.schema_version, CURRENT_SCHEMA_VERSION);
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
      body: JSON.stringify(approvalRequest({ source: "codex", title: "MCP approval", body: "Need approval" }))
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

test("exposes Human Cards for management and redacted agent resolution (AGH-001)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-human-cards-api-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    // Management is launch-only and ships the seeded primary operator.
    const listed = await fetch(`${localUrl}/api/human-cards`, { headers: authorized() }).then((response) => response.json()) as Array<{ alias: string }>;
    assert.deepEqual(listed.map((card) => card.alias), ["operator:primary"]);

    const created = await fetch(`${localUrl}/api/human-cards`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ alias: "operator:release_approval", display_name: "Release Approver", role: "operator", authority_scopes: ["release_approval"], notes: "private" })
    });
    assert.equal(created.status, 201);

    // Agents authenticate with the MCP token and resolve authority by alias.
    const mcpToken = ((await (await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() })).json()) as { token: string }).token;
    const mcpHeaders = { Authorization: `Bearer ${mcpToken}` };

    const resolved = await fetch(`${localUrl}/api/human-cards/resolve?alias=operator:release_approval`, { headers: mcpHeaders });
    assert.equal(resolved.status, 200);
    const resolvedCard = await resolved.json() as Record<string, unknown>;
    assert.equal(resolvedCard.resolved_via, "operator:release_approval");
    assert.deepEqual(resolvedCard.authority_scopes, ["release_approval"]);
    assert.equal(resolvedCard.notes, undefined); // operator-private, never exposed to agents

    // Unconfigured operator:* alias falls back to the primary operator.
    const fallback = await fetch(`${localUrl}/api/human-cards/resolve?alias=operator:security_approval`, { headers: mcpHeaders }).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(fallback.resolved_via, "operator:primary");

    // Agents cannot list/manage cards, only resolve.
    assert.equal((await fetch(`${localUrl}/api/human-cards`, { headers: mcpHeaders })).status, 401);
    // Unknown non-operator aliases are not resolvable.
    assert.equal((await fetch(`${localUrl}/api/human-cards/resolve?alias=agent:rogue`, { headers: mcpHeaders })).status, 404);

    // The primary card is protected; other cards can be deleted by the operator.
    assert.equal((await fetch(`${localUrl}/api/human-cards/operator:primary`, { method: "DELETE", headers: authorized() })).status, 400);
    assert.equal((await fetch(`${localUrl}/api/human-cards/operator:release_approval`, { method: "DELETE", headers: authorized() })).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checks authority scopes and gates under-authorized requests (AGH-002)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-authority-api-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    // A limited operator that holds only release_approval.
    await fetch(`${localUrl}/api/human-cards`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ alias: "operator:release_approval", role: "operator", authority_scopes: ["release_approval"] })
    });

    const mcpToken = ((await (await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() })).json()) as { token: string }).token;
    const mcpHeaders = { Authorization: `Bearer ${mcpToken}` };

    // Agent dry-run checks (mcp-safe).
    const granted = await fetch(`${localUrl}/api/authority/check?alias=operator:primary&scope=security_approval`, { headers: mcpHeaders }).then((r) => r.json()) as { granted: boolean };
    assert.equal(granted.granted, true);
    const denied = await fetch(`${localUrl}/api/authority/check?alias=operator:release_approval&scope=security_approval`, { headers: mcpHeaders }).then((r) => r.json()) as { granted: boolean; escalate_to: string[] };
    assert.equal(denied.granted, false);
    assert.ok(denied.escalate_to.includes("operator:primary"));
    assert.equal((await fetch(`${localUrl}/api/authority/check?scope=bogus`, { headers: mcpHeaders })).status, 400);

    // Ingestion gate: a request requiring security_approval addressed to the
    // release-only operator is rejected with escalation; addressed to the default
    // primary it is accepted; a request with no required_authority is unaffected.
    const channelToken = await createChannel(localUrl);
    const post = (body: Record<string, unknown>) => fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { ...mcpHeaders, "Content-Type": "application/json", "X-ForgeLink-Channel-Token": channelToken },
      body: JSON.stringify(approvalRequest({ source: "codex", title: "t", body: "b", ...body }))
    });

    const blocked = await post({ required_authority: "security_approval", to_human: "operator:release_approval" });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json() as { reason: string }).reason, "insufficient_authority");
    assert.equal((await post({ required_authority: "security_approval" })).status, 201); // defaults to operator:primary
    assert.equal((await post({})).status, 201); // backward compatible
    assert.equal((await post({ required_authority: "bogus" })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ties agent requests to identities and manages the registry (AGH-003)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-agent-identity-api-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const mcpToken = ((await (await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() })).json()) as { token: string }).token;
    const channelToken = await createChannel(localUrl);

    // A posted agent message ties to a first-class identity (auto-registered unknown).
    const posted = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", "X-ForgeLink-Channel-Token": channelToken },
      body: JSON.stringify(approvalRequest({ source: "codex", title: "t", body: "b" }))
    });
    assert.equal(posted.status, 201);
    assert.deepEqual((await posted.json() as { agent: unknown }).agent, { id: "codex", trust_state: "unknown" });

    // Registry is operator-only and shows the auto-registered agent.
    assert.equal((await fetch(`${localUrl}/api/agent-identities`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);
    const listed = await fetch(`${localUrl}/api/agent-identities`, { headers: authorized() }).then((r) => r.json()) as Array<{ id: string; trust_state: string; last_seen_at: string | null }>;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "codex");
    assert.ok(listed[0].last_seen_at);

    // Operator promotes the agent to trusted.
    const promoted = await fetch(`${localUrl}/api/agent-identities`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: "codex", display_name: "Codex", owner: "platform", trust_state: "trusted" })
    });
    assert.equal(promoted.status, 201);
    assert.equal((await promoted.json() as { identity: { trust_state: string } }).identity.trust_state, "trusted");
    // Invalid trust state is rejected.
    assert.equal((await fetch(`${localUrl}/api/agent-identities`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ id: "codex", trust_state: "supreme" }) })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("enforces agent trust states and audits transitions (AGH-004)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-agent-trust-api-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const mcpToken = ((await (await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() })).json()) as { token: string }).token;
    const channelToken = await createChannel(localUrl);
    const post = (body: Record<string, unknown>) => fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", "X-ForgeLink-Channel-Token": channelToken },
      body: JSON.stringify(approvalRequest({ source: "codex", title: "t", body: "b", ...body }))
    });
    const setTrust = (state: string) => fetch(`${localUrl}/api/agent-identities/codex/trust`, {
      method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ trust_state: state, reason: `set ${state}` })
    });

    // A new (unknown) agent is conservative: normal is fine, urgent is refused.
    assert.equal((await post({ urgency: "normal" })).status, 201);
    const urgentDenied = await post({ urgency: "urgent" });
    assert.equal(urgentDenied.status, 403);
    assert.equal((await urgentDenied.json() as { reason: string }).reason, "insufficient_trust_for_urgent");

    // Promote to trusted (audited) -> urgent now allowed.
    assert.equal((await setTrust("trusted")).status, 200);
    assert.equal((await post({ urgency: "urgent" })).status, 201);

    // Mute -> cannot interrupt at all.
    assert.equal((await setTrust("muted")).status, 200);
    const muted = await post({ urgency: "normal" });
    assert.equal(muted.status, 403);
    assert.equal((await muted.json() as { reason: string }).reason, "agent_muted");

    // Block -> cannot interrupt.
    assert.equal((await setTrust("blocked")).status, 200);
    assert.equal((await post({ urgency: "normal" })).status, 403);

    // The transition audit log is operator-only and records each change with reason.
    assert.equal((await fetch(`${localUrl}/api/agent-identities/codex/trust-events`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);
    const events = await fetch(`${localUrl}/api/agent-identities/codex/trust-events`, { headers: authorized() }).then((r) => r.json()) as Array<{ from_state: string; to_state: string; reason: string }>;
    assert.deepEqual(events.map((event) => event.to_state), ["blocked", "muted", "trusted"]);
    assert.equal(events[2].from_state, "unknown");
    assert.equal(events[0].reason, "set blocked");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts authenticated agent channel messages and records human actions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-agent-api-"));
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const unauthorized = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    const token = await createChannel(localUrl);

    const templates = await fetch(`${localUrl}/api/approval-templates`, { headers: authorized() }).then((response) => response.json()) as Array<{ id: string; minimum_evidence: string[]; audit_required: boolean }>;
    assert.ok(templates.find((template) => template.id === "github_release")?.minimum_evidence.includes("rollback_plan"));
    assert.equal(templates.find((template) => template.id === "external_message")?.audit_required, true);

    const dryRun = await fetch(`${localUrl}/api/approval-requests/dry-run`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify(approvalRequest({ template_id: "github_release", risk: "high", urgency: "normal", evidence_pack: { summary: "Too thin" } }))
    });
    assert.equal(dryRun.status, 200);
    const dryRunPayload = await dryRun.json() as { approval_required: boolean; estimated_risk: string; missing_evidence: string[]; batching_defer_recommendation: string; validation_errors: string[]; template: { id: string }; interruption_policy: string; escalation_behavior: string; preferred_channel: string };
    assert.equal(dryRunPayload.approval_required, true);
    assert.equal(dryRunPayload.estimated_risk, "high");
    assert.equal(dryRunPayload.template.id, "github_release");
    assert.equal(dryRunPayload.batching_defer_recommendation, "send_now");
    assert.equal(dryRunPayload.interruption_policy, "urgent_interrupt");
    assert.equal(dryRunPayload.preferred_channel, "desktop_interrupt");
    assert.equal(dryRunPayload.escalation_behavior, "escalate_channel_if_unanswered");
    assert.ok(dryRunPayload.missing_evidence.includes("rollback_plan"));
    assert.ok(dryRunPayload.validation_errors.length >= 1);

    const created = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token },
      body: JSON.stringify(approvalRequest({
        id: "agent-http-1",
        title: "Task needs approval",
        body: "ForgeWire wants to run a release workflow.",
        requested_action: "Run the release workflow.",
        affected_resources: ["repo:ForgeLink", "workflow:release"]
      }))
    });
    assert.equal(created.status, 201);
    const listed = await fetch(`${localUrl}/api/agent-messages`, { headers: authorized() }).then((response) => response.json()) as Array<{ id: string; status: string; requested_action: string; affected_resources: string; required_authority: string; decision_options: string; template_id: string; evidence_pack: string; interruption_policy: string; escalation_behavior: string; expected_response_time: string; no_response_behavior: string; can_batch: number }>;
    assert.deepEqual(listed.map((message) => message.id), ["agent-http-1"]);
    assert.equal(listed[0].status, "unread");
    assert.equal(listed[0].requested_action, "Run the release workflow.");
    assert.deepEqual(JSON.parse(listed[0].affected_resources), ["repo:ForgeLink", "workflow:release"]);
    assert.equal(listed[0].required_authority, "general_approval");
    assert.deepEqual(JSON.parse(listed[0].decision_options).map((option: { id: string }) => option.id), ["approve", "deny"]);
    assert.equal(listed[0].template_id, "file_write");
    assert.equal(JSON.parse(listed[0].evidence_pack).redaction_profile, "desktop_full");
    assert.equal(listed[0].interruption_policy, "normal_approval");
    assert.equal(listed[0].escalation_behavior, "deny_or_defer_on_timeout");
    assert.equal(listed[0].expected_response_time, "15 minutes");
    assert.equal(listed[0].no_response_behavior, "deny_on_timeout");
    assert.equal(listed[0].can_batch, 0);

    const incomplete = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token },
      body: JSON.stringify({ source: "forgewire", kind: "approval_request", title: "Incomplete", body: "Missing structured fields." })
    });
    assert.equal(incomplete.status, 400);

    const acted = await fetch(`${localUrl}/api/agent-messages/agent-http-1/actions/approve`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ comment: "Approved by operator", device_id: "desktop-1" }) });
    assert.equal(acted.status, 200);
    const actedPayload = await acted.json() as { message: { status: string; action_result: string }; decision: { id: string; decision: string; authority_grant: string; operator_alias: string; decision_comment: string } };
    assert.equal(actedPayload.message.status, "acted");
    assert.match(actedPayload.message.action_result, /approve/);
    // The operator action is persisted as a Decision Record (AGH-013): the chosen
    // option, operator/device, comment, and the granted authority are recorded.
    assert.equal(actedPayload.decision.decision, "approve");
    assert.equal(actedPayload.decision.authority_grant, "general_approval");
    assert.equal(actedPayload.decision.operator_alias, "operator:primary");
    assert.equal(actedPayload.decision.decision_comment, "Approved by operator");
    // The decision is replayable per request and visible in the operator-only list.
    const replay = await fetch(`${localUrl}/api/agent-messages/agent-http-1/decision`, { headers: authorized() }).then((r) => r.json()) as { id: string; decision: string };
    assert.equal(replay.id, actedPayload.decision.id);
    assert.equal(replay.decision, "approve");
    const records = await fetch(`${localUrl}/api/decision-records`, { headers: authorized() }).then((r) => r.json()) as Array<{ approval_request_id: string }>;
    assert.deepEqual(records.map((record) => record.approval_request_id), ["agent-http-1"]);
    // Decision Records are operator-only; an agent (MCP) token cannot read them.
    const mcpToken = ((await (await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() })).json()) as { token: string }).token;
    assert.equal((await fetch(`${localUrl}/api/decision-records`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);

    // The governed lifecycle is committed to the tamper-evident audit chain (AGH-016):
    // approval request, evidence pack, then the operator decision, and it verifies.
    const chain = await fetch(`${localUrl}/api/audit-chain?approval_request_id=agent-http-1`, { headers: authorized() }).then((r) => r.json()) as Array<{ entry_type: string }>;
    assert.deepEqual(chain.map((entry) => entry.entry_type), ["approval_request", "evidence_pack", "decision"]);
    const verified = await fetch(`${localUrl}/api/audit-chain/verify`, { headers: authorized() }).then((r) => r.json()) as { ok: boolean; length: number };
    assert.equal(verified.ok, true);
    assert.ok(verified.length >= 3);
    // The audit chain is operator-only; an agent (MCP) token cannot read or verify it.
    assert.equal((await fetch(`${localUrl}/api/audit-chain`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);
    assert.equal((await fetch(`${localUrl}/api/audit-chain/verify`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);

    // After approval the request is dangling until the agent reports an outcome (AGH-015).
    const danglingBefore = await fetch(`${localUrl}/api/approvals/dangling`, { headers: authorized() }).then((r) => r.json()) as Array<{ id: string }>;
    assert.deepEqual(danglingBefore.map((m) => m.id), ["agent-http-1"]);
    // The agent reports the outcome over its MCP token; acting outside the approved
    // resources is flagged as a scope mismatch.
    const reported = await fetch(`${localUrl}/api/agent-messages/agent-http-1/outcome`, {
      method: "POST", headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ outcome_state: "action_succeeded", outcome_summary: "Published", reported_resources: ["repo:OtherRepo"] })
    });
    assert.equal(reported.status, 201);
    assert.equal((await reported.json() as { outcome: { scope_match: number } }).outcome.scope_match, 0);
    // The terminal outcome clears the dangling list; the mismatch is surfaced to the operator.
    assert.deepEqual(await fetch(`${localUrl}/api/approvals/dangling`, { headers: authorized() }).then((r) => r.json()), []);
    const mismatches = await fetch(`${localUrl}/api/approvals/scope-mismatches`, { headers: authorized() }).then((r) => r.json()) as Array<{ approval_request_id: string }>;
    assert.deepEqual(mismatches.map((o) => o.approval_request_id), ["agent-http-1"]);
    assert.equal((await fetch(`${localUrl}/api/agent-messages/agent-http-1/outcomes`, { headers: authorized() }).then((r) => r.json()) as Array<unknown>).length, 1);
    // Outcome views are operator-only; the agent cannot read them.
    assert.equal((await fetch(`${localUrl}/api/approvals/dangling`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);

    // Approval replay (AGH-017): the operator can inspect the full lifecycle of the
    // request. The default surface shows full detail; a redacted profile preview
    // withholds private bodies while keeping the lifecycle and integrity hashes.
    const replayed = await fetch(`${localUrl}/api/agent-messages/agent-http-1/replay`, { headers: authorized() }).then((r) => r.json()) as { redacted: boolean; final_state: string; decided: boolean; steps: Array<{ step: string; detail: Record<string, unknown> }>; audit_verification: { ok: boolean } };
    assert.equal(replayed.decided, true);
    assert.equal(replayed.redacted, false);
    assert.equal(replayed.final_state, "action_succeeded");
    assert.deepEqual(replayed.steps.map((s) => s.step), ["request_received", "risk_classified", "evidence_shown", "decision_made", "action_reported", "final_state"]);
    assert.equal(replayed.audit_verification.ok, true);
    const redactedReplay = await fetch(`${localUrl}/api/agent-messages/agent-http-1/replay?redaction_profile=mobile_lock_screen`, { headers: authorized() }).then((r) => r.json()) as { redacted: boolean; steps: Array<{ step: string; detail: Record<string, unknown> }> };
    assert.equal(redactedReplay.redacted, true);
    assert.equal(redactedReplay.steps[0].detail.body, undefined);
    // Replay is operator-only and 404s for an unknown request.
    assert.equal((await fetch(`${localUrl}/api/agent-messages/agent-http-1/replay`, { headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);
    assert.equal((await fetch(`${localUrl}/api/agent-messages/does-not-exist/replay`, { headers: authorized() })).status, 404);

    // Governance export (AGH-018): redacted by default; a full export needs explicit
    // confirmation; operator-only.
    const govExport = await fetch(`${localUrl}/api/governance/export`, { method: "POST", headers: authorized() }).then((r) => r.json()) as { ok: boolean; name: string; mode: string; audit_verification: { ok: boolean } };
    assert.equal(govExport.ok, true);
    assert.match(govExport.name, /^governance-export-/);
    assert.equal(govExport.mode, "redacted");
    assert.equal(govExport.audit_verification.ok, true);
    // Asking for a full export without confirmation is rejected.
    assert.equal((await fetch(`${localUrl}/api/governance/export`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ full: true }) })).status, 400);
    const fullExport = await fetch(`${localUrl}/api/governance/export`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ full: true, confirm_full: true }) }).then((r) => r.json()) as { mode: string };
    assert.equal(fullExport.mode, "full");
    // Governance export is operator-only; the agent (MCP) token cannot trigger it.
    assert.equal((await fetch(`${localUrl}/api/governance/export`, { method: "POST", headers: { Authorization: `Bearer ${mcpToken}` } })).status, 401);

    const contactId = database.upsertContact("Fabric", "+15550001111");
    database.addContactPoint(contactId, "handle", "fabric-agent", "agent", false);
    let policyRejected = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token },
      body: JSON.stringify(approvalRequest({ id: "agent-policy-approval", source: "fabric-agent", title: "Blocked approval", body: "Needs policy." }))
    });
    assert.equal(policyRejected.status, 403);
    assert.equal((await policyRejected.json() as { reason: string }).reason, "approval_requests_disallowed");

    database.setContactPolicy(contactId, { trust_level: "operator", allow_agent_messages: true, allow_approval_requests: true, allow_urgent_interrupts: false });
    // Trust the agent (AGH-004) so the request reaches the contact-policy urgent gate.
    database.upsertAgentIdentity({ id: "fabric-agent", trust_state: "trusted" });
    policyRejected = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token },
      body: JSON.stringify({ id: "agent-policy-urgent", source: "fabric-agent", kind: "alert", urgency: "urgent", title: "Blocked urgent", body: "Needs urgent policy." })
    });
    assert.equal(policyRejected.status, 403);
    assert.equal((await policyRejected.json() as { reason: string }).reason, "urgent_interrupts_disallowed");
    database.setContactPolicy(contactId, { trust_level: "operator", allow_agent_messages: true, allow_approval_requests: true, allow_urgent_interrupts: true });
    const policyAllowed = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token },
      body: JSON.stringify(approvalRequest({ id: "agent-policy-ok", source: "fabric-agent", title: "Allowed approval", body: "Policy allows it." }))
    });
    assert.equal(policyAllowed.status, 201);

    const invalid = await fetch(`${localUrl}/api/agent-channels/forgewire/messages`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ source: "forgewire", kind: "alert", urgency: "loud", title: "Bad", body: "Bad" }) });
    assert.equal(invalid.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("surfaces decision-memory suggestions and records explicit confirmation (AGH-014)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-decision-memory-api-"));
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const mcpToken = ((await (await fetch(`${localUrl}/api/mcp/token`, { method: "POST", headers: authorized() })).json()) as { token: string }).token;
    // Three repeated approvals of the same pattern establish a memory candidate.
    for (let n = 0; n < 3; n += 1) {
      const id = `dm-${n}`;
      database.addAgentMessage({ id, channel_id: "forgewire", source: "codex", kind: "approval_request", urgency: "normal", title: "Release", body: "Publish", template_id: "github_release", required_authority: "release_approval", affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }] });
      database.recordDecision({ approval_request_id: id, decision: "approve" });
    }

    const suggestions = await fetch(`${localUrl}/api/decision-memory/suggestions`, { headers: authorized() }).then((r) => r.json()) as Array<{ source: string; suggested_decision: string; occurrences: number }>;
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].source, "codex");
    assert.equal(suggestions[0].suggested_decision, "approve");
    assert.equal(suggestions[0].occurrences, 3);

    // Confirmation requires an explicit operator action and a valid decision.
    assert.equal((await fetch(`${localUrl}/api/decision-memory/confirm`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ source: "codex", template_id: "github_release", required_authority: "release_approval", suggested_decision: "maybe" }) })).status, 400);
    const confirmed = await fetch(`${localUrl}/api/decision-memory/confirm`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ source: "codex", template_id: "github_release", required_authority: "release_approval", suggested_decision: "approve", occurrences: 3, note: "Routine" }) });
    assert.equal(confirmed.status, 201);
    assert.equal((await confirmed.json() as { rule: { status: string } }).rule.status, "confirmed");

    // The confirmed pattern is no longer suggested and is listed as a rule.
    assert.deepEqual(await fetch(`${localUrl}/api/decision-memory/suggestions`, { headers: authorized() }).then((r) => r.json()), []);
    assert.equal((await fetch(`${localUrl}/api/decision-memory`, { headers: authorized() }).then((r) => r.json()) as Array<unknown>).length, 1);

    // Decision memory is operator-only; an agent (MCP) token cannot read or write it.
    const mcp = { Authorization: `Bearer ${mcpToken}` };
    assert.equal((await fetch(`${localUrl}/api/decision-memory/suggestions`, { headers: mcp })).status, 401);
    assert.equal((await fetch(`${localUrl}/api/decision-memory/confirm`, { method: "POST", headers: { ...mcp, "Content-Type": "application/json" }, body: JSON.stringify({ source: "codex", template_id: "github_release", required_authority: "release_approval", suggested_decision: "approve" }) })).status, 401);
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
  const message = (id: string, urgency = "urgent") => JSON.stringify(approvalRequest({ id, urgency, title: `Approval ${id}`, body: "Need approval" }));
  try {
    const token = await createChannel(localUrl);
    const headers = { "Content-Type": "application/json", "X-ForgeLink-Channel-Token": token };
    // Urgent interrupts require a trusted agent (AGH-004); trust forgewire so this
    // test exercises the urgency rate limit rather than the trust gate.
    await fetch(`${localUrl}/api/agent-identities`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ id: "forgewire", trust_state: "trusted" }) });
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

test("starts, ends, and reconciles Twilio Voice calls through provider-neutral rows (CLV-013)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-voice-http-"));
  const previous = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    number: process.env.TWILIO_PHONE_NUMBER,
    base: process.env.TWILIO_PUBLIC_BASE_URL
  };
  process.env.TWILIO_ACCOUNT_SID = `AC${"c".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "voice-token";
  process.env.TWILIO_PHONE_NUMBER = "+15550000000";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example.com";
  const startedRequests: Array<{ to: string; from?: string }> = [];
  const endedCalls: string[] = [];
  const { server, database } = createBackend({
    host: "127.0.0.1",
    port: 0,
    dataDir: directory,
    apiToken,
    startCall: async (request) => {
      startedRequests.push({ to: request.to, from: request.from });
      return { sid: "CA-HTTP", status: "queued" };
    },
    endCall: async (providerCallId) => {
      endedCalls.push(providerCallId);
      return { sid: providerCallId, status: "completed" };
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(`${localUrl}${path}`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${localUrl}/api/calls/start`, { method: "POST", body: "{}" })).status, 401);
    const contactId = database.upsertContact("Ada", "+15551234567");
    const started = await post("/api/calls/start", { local_call_id: "call-http-1", to: "+15551234567", contact_id: contactId });
    assert.equal(started.status, 200);
    const startedPayload = await started.json() as { call: { local_call_id: string; provider_call_id: string; status: string; contact_id: number } };
    assert.equal(startedPayload.call.local_call_id, "call-http-1");
    assert.equal(startedPayload.call.provider_call_id, "CA-HTTP");
    assert.equal(startedPayload.call.status, "queued");
    assert.equal(startedPayload.call.contact_id, contactId);
    assert.deepEqual(startedRequests, [{ to: "+15551234567", from: "+15550000000" }]);
    assert.equal((await post("/api/calls/start", { local_call_id: "call-http-1", to: "+15551234567" })).status, 202);

    const statusFields = { CallSid: "CA-HTTP", CallStatus: "in-progress", Timestamp: "2026-06-20T21:10:00Z" };
    const statusResponse = await fetch(`${localUrl}/webhooks/voice/status`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature("https://phone.example.com", "/webhooks/voice/status", statusFields, "voice-token") }, body: new URLSearchParams(statusFields) });
    assert.equal(statusResponse.status, 200);
    assert.equal(database.callByProviderCallId("CA-HTTP")?.status, "in_progress");

    const ended = await post("/api/calls/end", { local_call_id: "call-http-1" });
    assert.equal(ended.status, 200);
    assert.deepEqual(endedCalls, ["CA-HTTP"]);
    assert.equal(database.callByProviderCallId("CA-HTTP")?.status, "completed");

    const lateFailure = { CallSid: "CA-HTTP", CallStatus: "failed", Timestamp: "2026-06-20T21:11:00Z" };
    assert.equal((await fetch(`${localUrl}/webhooks/voice/status`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature("https://phone.example.com", "/webhooks/voice/status", lateFailure, "voice-token") }, body: new URLSearchParams(lateFailure) })).status, 200);
    assert.equal(database.callByProviderCallId("CA-HTTP")?.status, "completed");

    const inbound = { CallSid: "CA-IN", Direction: "inbound", From: "+15557654321", To: "+15550000000", CallStatus: "ringing", Timestamp: "2026-06-20T21:12:00Z" };
    assert.equal((await fetch(`${localUrl}/webhooks/voice/status`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature("https://phone.example.com", "/webhooks/voice/status", inbound, "voice-token") }, body: new URLSearchParams(inbound) })).status, 200);
    const inboundCall = database.callByProviderCallId("CA-IN")!;
    assert.equal(inboundCall.direction, "inbound");
    assert.equal(inboundCall.from_number, "+15557654321");

    assert.equal((await fetch(`${localUrl}/webhooks/voice/status`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" }, body: new URLSearchParams(statusFields) })).status, 403);
    const twimlFields = { CallSid: "CA-HTTP" };
    const twiml = await fetch(`${localUrl}/webhooks/voice/twiml`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature("https://phone.example.com", "/webhooks/voice/twiml", twimlFields, "voice-token") }, body: new URLSearchParams(twimlFields) });
    assert.equal(twiml.status, 200);
    assert.match(await twiml.text(), /<Response>/);
  } finally {
    for (const [key, value] of Object.entries({ TWILIO_ACCOUNT_SID: previous.sid, TWILIO_AUTH_TOKEN: previous.token, TWILIO_PHONE_NUMBER: previous.number, TWILIO_PUBLIC_BASE_URL: previous.base })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    assert.equal(text.includes("CA-DIAGNOSTIC-PRIVATE"), false);
    assert.equal(text.includes("+15551234567"), false);
    assert.equal(text.includes("call-diagnostic-private"), false);
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

test("Telnyx webhook stores signed inbound, dedupes, and rejects bad signatures (CLV-007)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-telnyx-"));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const previous = process.env.TELNYX_PUBLIC_KEY;
  process.env.TELNYX_PUBLIC_KEY = der.subarray(der.length - 32).toString("base64");
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const post = (body: string, signature?: string, ts = "1718000000") =>
    fetch(`http://127.0.0.1:${port}/webhooks/telnyx`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "telnyx-timestamp": ts, "telnyx-signature-ed25519": signature ?? sign(null, Buffer.from(`${ts}|${body}`, "utf8"), privateKey).toString("base64") },
      body
    });
  try {
    const inbound = JSON.stringify({ data: { event_type: "message.received", payload: { id: "TX-IN", from: { phone_number: "+15557654321" }, to: [{ phone_number: "+15550002222" }], text: "telnyx hi", media: [] } } });
    assert.equal((await post(inbound)).status, 200);
    assert.equal((await post(inbound)).status, 200); // duplicate webhook
    const thread = database.threads().find((t) => t.canonical_number === "+15557654321")!;
    assert.equal(database.messages(thread.id).length, 1); // idempotent on provider message id
    assert.equal(database.messages(thread.id)[0].body, "telnyx hi");
    assert.equal((await post(inbound, "AAAA")).status, 403); // invalid signature
  } finally {
    if (previous === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("contacts metadata, points, and policy over HTTP (CLV-009/010/011)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-contacts-http-"));
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(`${localUrl}${path}`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${localUrl}/api/contacts/update`, { method: "POST", body: "{}" })).status, 401); // auth required
    const { id } = await (await post("/api/contacts", { name: "Grace", number: "+15551230000" })).json() as { id: number };
    assert.equal((await post("/api/contacts/update", { id, company: "Navy", trust_level: "trusted", pinned: true })).status, 200);
    const contact = (await (await fetch(`${localUrl}/api/contacts`, { headers: authorized() })).json() as Array<Record<string, unknown>>).find((c) => c.id === id) as Record<string, unknown>;
    assert.equal(contact.company, "Navy");
    assert.equal(contact.pinned, 1);
    await post("/api/contacts/points", { contact_id: id, kind: "email", value: "grace@example.com", label: "work" });
    const points = await (await fetch(`${localUrl}/api/contacts/points?contact_id=${id}`, { headers: authorized() })).json() as Array<Record<string, unknown>>;
    assert.ok(points.some((p) => p.value === "grace@example.com"));
    assert.equal((await post("/api/contacts/points/block", { point_id: points[0].id, blocked: true })).status, 200);
    const policy = await (await post("/api/contacts/policy", { contact_id: id, trust_level: "trusted", allow_approval_requests: true })).json() as Record<string, unknown>;
    assert.equal(policy.allow_approval_requests, 1);
    await post("/api/contacts/points", { contact_id: id, kind: "handle", value: "fabric", label: "agent" });
    database.addMessage({ id: "HTTP-TL", number: "+15551230000", direction: "inbound", body: "timeline message" });
    database.addAgentMessage({ id: "HTTP-AGENT-TL", channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "urgent", title: "Private title", body: "Private body", actions: [] });
    const timeline = await (await fetch(`${localUrl}/api/contacts/timeline?contact_id=${id}`, { headers: authorized() })).json() as Array<Record<string, unknown>>;
    assert.ok(timeline.some((item) => item.kind === "message" && item.detail === "timeline message"));
    assert.ok(timeline.some((item) => item.kind === "agent" && item.redacted === true && item.detail === "Private agent details hidden"));
    const revealedTimeline = await (await fetch(`${localUrl}/api/contacts/timeline?contact_id=${id}&include_agent_details=1`, { headers: authorized() })).json() as Array<Record<string, unknown>>;
    assert.ok(revealedTimeline.some((item) => item.kind === "agent" && String(item.detail).includes("Private body")));

    database.addMessage({ id: "HTTP-UNKNOWN", number: "+15550001111", direction: "inbound", body: "hello" });
    let unknown = database.threads().find((thread) => thread.canonical_number === "+15550001111")!;
    assert.equal((await post("/api/link-thread", { thread_id: unknown.id, contact_id: id })).status, 200);
    assert.ok(database.contactPoints(id).some((point) => point.value === "+15550001111"));

    database.addMessage({ id: "HTTP-IGNORE", number: "+15550002222", direction: "inbound", body: "ignore" });
    unknown = database.threads().find((thread) => thread.canonical_number === "+15550002222")!;
    assert.equal((await post("/api/unknown-number/ignore", { thread_id: unknown.id })).status, 200);
    assert.equal(database.threads().find((thread) => thread.id === unknown.id)!.unread_count, 0);

    database.addMessage({ id: "HTTP-BLOCK", number: "+15550003333", direction: "inbound", body: "block" });
    unknown = database.threads().find((thread) => thread.canonical_number === "+15550003333")!;
    const blocked = await (await post("/api/unknown-number/block", { thread_id: unknown.id })).json() as Record<string, unknown>;
    assert.equal(database.getContactPolicy(Number(blocked.id)).blocked, 1);

    database.addMessage({ id: "HTTP-NEW", number: "+15550004444", direction: "inbound", body: "new" });
    unknown = database.threads().find((thread) => thread.canonical_number === "+15550004444")!;
    const created = await (await post("/api/contacts/from-thread", { thread_id: unknown.id, name: "Katherine" })).json() as Record<string, unknown>;
    assert.equal(database.threads().find((thread) => thread.id === unknown.id)!.name, "Katherine");
    assert.ok(database.contactPoints(Number(created.id)).some((point) => point.value === "+15550004444"));

    assert.equal((await post("/api/contacts/delete", { id })).status, 200);
    const after = await (await fetch(`${localUrl}/api/contacts`, { headers: authorized() })).json() as Array<Record<string, unknown>>;
    assert.equal(after.some((c) => c.id === id), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
