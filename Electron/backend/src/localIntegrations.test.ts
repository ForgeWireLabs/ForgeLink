import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalIntegrationBoundary, LocalIntegrationRegistry, LocalIntegrationRequest } from "./localIntegrations";

const now = 1_800_000_000_000;
const body = Buffer.from(JSON.stringify({ schema_version: 1, event_id: "evt-1", event_type: "signal", occurred_at: new Date(now).toISOString(), payload: {} }));
const base = (overrides: Partial<LocalIntegrationRequest> = {}): LocalIntegrationRequest => ({ integrationId: "home-assistant", remoteAddress: "127.0.0.1", host: "127.0.0.1:5055", origin: "", contentType: "application/json", authorization: "", channelToken: "secret", signature: "", timestamp: "", nonce: "", body, ...overrides });

test("LAN-001: capability discovery is redacted and exposes only implemented contracts", () => {
  const capabilities = new LocalIntegrationBoundary({ enabled: true, allowLan: false, integrationId: "home-assistant", secret: "secret", now: () => now }).capabilities() as any;
  assert.equal(capabilities.state, "ready"); assert.deepEqual(capabilities.inbound.normalized_types, ["agent_message"]); assert.equal(capabilities.outbound.state, "pending_actions_available"); assert.equal(capabilities.diagnostics.credential_values_redacted, true); assert.doesNotMatch(JSON.stringify(capabilities), /"secret"/);
});

test("LAN-003/LAN-005: registry persists only hashes and enforces lifecycle, scopes, replay, and expiry", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-local-registry-"));
  try {
    const registry = new LocalIntegrationRegistry(directory);
    registry.create("home-assistant", "Home Assistant", ["agent_message", "actions"], "plaintext-token");
    assert.equal(registry.verifyToken("home-assistant", "plaintext-token"), true);
    assert.doesNotMatch(readFileSync(join(directory, "local-integrations.json"), "utf8"), /plaintext-token/);
    const created = registry.createPendingAction("home-assistant", "acknowledge", 300);
    assert.equal(registry.completePendingAction("home-assistant", created.token, "succeeded").ok, true);
    assert.equal(registry.completePendingAction("home-assistant", created.token, "succeeded").code, "action_replay_rejected");
    const expired = registry.createPendingAction("home-assistant", "acknowledge", 30);
    assert.equal(registry.completePendingAction("home-assistant", expired.token, "succeeded", Date.now() + 31_000).code, "action_expired");
    registry.rotate("home-assistant", "rotated-token"); assert.equal(registry.verifyToken("home-assistant", "plaintext-token"), false); assert.equal(registry.verifyToken("home-assistant", "rotated-token"), true);
    registry.setEnabled("home-assistant", false); assert.equal(registry.verifyToken("home-assistant", "rotated-token"), false); registry.setEnabled("home-assistant", true);
    registry.revoke("home-assistant"); assert.equal(registry.verifyToken("home-assistant", "rotated-token"), false); assert.throws(() => registry.setEnabled("home-assistant", true), /Rotate/);
    assert.equal(new LocalIntegrationRegistry(directory).record("home-assistant")?.revoked_at !== null, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("LAN-002: local ingress is disabled by default and loopback-gated", () => {
  assert.equal(new LocalIntegrationBoundary({ enabled: false, allowLan: false, integrationId: "home-assistant", secret: "secret" }).inspect(base()).code, "local_integration_disabled");
  const boundary = new LocalIntegrationBoundary({ enabled: true, allowLan: false, integrationId: "home-assistant", secret: "secret" });
  assert.equal(boundary.inspect(base({ remoteAddress: "192.168.1.20" })).code, "network_scope_rejected"); assert.equal(boundary.inspect(base({ host: "example.com" })).code, "host_rejected"); assert.equal(boundary.inspect(base({ origin: "https://evil.example" })).code, "origin_rejected");
});
test("LAN-002: explicit LAN opt-in permits private sources but rejects public sources", () => {
  const boundary = new LocalIntegrationBoundary({ enabled: true, allowLan: true, integrationId: "home-assistant", secret: "secret" });
  assert.equal(boundary.inspect(base({ remoteAddress: "192.168.1.20", host: "forgebox.local:5055" })).ok, true); assert.equal(boundary.inspect(base({ remoteAddress: "8.8.8.8", host: "forgebox.local:5055" })).code, "network_scope_rejected");
});
test("LAN-002: HMAC authentication rejects replay and enforces rate and body bounds", () => {
  const boundary = new LocalIntegrationBoundary({ enabled: true, allowLan: false, integrationId: "home-assistant", secret: "secret", rateLimitPerMinute: 3, now: () => now });
  const timestamp = String(now / 1000), nonce = "nonce-1"; const signature = createHmac("sha256", "secret").update(`${timestamp}.${nonce}.`).update(body).digest("hex"); const signed = base({ channelToken: "", timestamp, nonce, signature });
  assert.deepEqual(boundary.inspect(signed), { ok: true, status: 200, code: "authenticated", authMode: "hmac-sha256" }); assert.equal(boundary.inspect(signed).code, "replay_rejected"); assert.equal(boundary.inspect(base({ channelToken: "wrong" })).code, "authentication_required"); assert.equal(boundary.inspect(base()).code, "rate_limited");
  const bounds = new LocalIntegrationBoundary({ enabled: true, allowLan: false, integrationId: "home-assistant", secret: "secret" }); assert.equal(bounds.inspect(base({ body: Buffer.alloc(65 * 1024) })).code, "payload_out_of_bounds"); assert.equal(bounds.inspect(base({ contentType: "text/plain" })).code, "json_required");
});
