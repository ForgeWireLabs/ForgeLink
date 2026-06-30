import assert from "node:assert/strict";
import test from "node:test";
import { createChannelRegistry, UnsupportedCapabilityError } from "./channels";
import {
  PUSH_LIMITS,
  PushTransport,
  RedactedPush,
  createPushAdapter,
  loadPushConfig,
  mapPushError,
  normalizePushProfile,
  pushConfigured,
  redactPush
} from "./push";

// Configure a push provider/topic so the channel is treated as enabled. Tests
// inject a fake transport, so no real push server is contacted.
function configurePush(profile?: string): void {
  process.env.FORGELINK_PUSH_URL = "https://push.example.com";
  process.env.FORGELINK_PUSH_TOPIC = "forgelink-ops";
  if (profile) process.env.FORGELINK_PUSH_PROFILE = profile;
  else delete process.env.FORGELINK_PUSH_PROFILE;
}
function clearPushConfig(): void {
  for (const key of ["FORGELINK_PUSH_PROVIDER", "FORGELINK_PUSH_URL", "FORGELINK_PUSH_TOPIC", "FORGELINK_PUSH_TOKEN", "FORGELINK_PUSH_PROFILE"]) delete process.env[key];
}

const capture = (): { calls: RedactedPush[]; transport: PushTransport } => {
  const calls: RedactedPush[] = [];
  const transport: PushTransport = async (payload) => { calls.push(payload); return { providerMessageId: "push-1" }; };
  return { calls, transport };
};

// --- PUSH-001 / PUSH-002: contracts, defaults, disabled-by-default posture ---

test("PUSH-002: defaults to ntfy and is disabled until a topic is configured", () => {
  clearPushConfig();
  const config = loadPushConfig();
  assert.equal(config.provider, "ntfy");
  assert.equal(config.baseUrl, "https://ntfy.sh");
  assert.equal(config.defaultProfile, "lock_screen_safe");
  assert.equal(pushConfigured(config), false);
});

test("PUSH-002: enabled once a provider URL and topic are present", () => {
  configurePush();
  assert.equal(pushConfigured(loadPushConfig()), true);
  clearPushConfig();
});

// --- PUSH-004: redaction profiles ------------------------------------------

test("PUSH-004: lock-screen-safe is the default and never emits caller content", () => {
  configurePush();
  const redacted = redactPush(
    { title: "Mom: are you coming?", body: "Approve the $4,200 wire to Acme", category: "approval" },
    loadPushConfig()
  );
  assert.equal(redacted.title, "ForgeLink");
  assert.equal(redacted.body, "An approval is waiting in ForgeLink.");
  assert.ok(!redacted.body.includes("4,200"));
  assert.ok(!redacted.title.includes("Mom"));
  assert.equal(redacted.topic, "forgelink-ops");
  clearPushConfig();
});

test("PUSH-004: full profile emits caller content but strips control chars and clamps", () => {
  configurePush("full");
  // Header-injection attempt via an embedded newline; built from a char code so the
  // source carries no raw control byte.
  const injected = "Wire approval" + String.fromCharCode(10) + "Priority: urgent";
  const redacted = redactPush({ title: injected, body: "x".repeat(PUSH_LIMITS.maxBody + 50), category: "approval" }, loadPushConfig());
  assert.ok(!redacted.title.includes(String.fromCharCode(10)));
  assert.equal(redacted.title, "Wire approval Priority: urgent");
  assert.equal(redacted.body.length, PUSH_LIMITS.maxBody);
  clearPushConfig();
});

test("PUSH-004: empty full content falls back to category-safe text", () => {
  configurePush("full");
  const redacted = redactPush({ category: "message" }, loadPushConfig());
  assert.equal(redacted.title, "ForgeLink");
  assert.equal(redacted.body, "You have a new message in ForgeLink.");
  clearPushConfig();
});

test("PUSH-004: an unrecognized profile falls back to lock-screen-safe", () => {
  assert.equal(normalizePushProfile("verbose"), "lock_screen_safe");
  assert.equal(normalizePushProfile(undefined), "lock_screen_safe");
  assert.equal(normalizePushProfile("FULL"), "full");
});

test("PUSH-004: correlation ref is sanitized to an opaque bounded token", () => {
  configurePush("full");
  const redacted = redactPush({ body: "hi", ref: "req-42/private name <x>" }, loadPushConfig());
  assert.equal(redacted.ref, "req-42privatenamex");
  clearPushConfig();
});

// --- Outbound send path behind the registry --------------------------------

test("send path: delivers a redacted notification through the injected transport", async () => {
  configurePush();
  const { calls, transport } = capture();
  const adapter = createPushAdapter(transport);
  const result = await adapter.sendPush({ body: "secret approval detail", category: "approval" });
  assert.equal(result.status, "sent");
  assert.equal(result.providerMessageId, "push-1");
  assert.equal(calls.length, 1);
  // What actually went to the transport carries no caller content under the default.
  assert.equal(calls[0].body, "An approval is waiting in ForgeLink.");
  clearPushConfig();
});

test("send path: disabled when unconfigured", async () => {
  clearPushConfig();
  const { transport } = capture();
  const adapter = createPushAdapter(transport);
  await assert.rejects(adapter.sendPush({ body: "x" }), /not configured/i);
});

test("send path: maps a provider failure to a caller-safe error", async () => {
  configurePush();
  const failing: PushTransport = async () => { throw Object.assign(new Error("boom"), { httpStatus: 500 }); };
  const adapter = createPushAdapter(failing);
  await assert.rejects(adapter.sendPush({ body: "x" }), (err: Error & { retriable?: boolean }) => {
    assert.match(err.message, /temporarily rejected/i);
    assert.equal(err.retriable, true);
    assert.ok(!err.message.includes("boom"));
    return true;
  });
  clearPushConfig();
});

test("registry: the push adapter is selectable by the push_send capability", () => {
  const registry = createChannelRegistry();
  const adapter = createPushAdapter(async () => ({ providerMessageId: null }));
  registry.register(adapter);
  assert.equal(registry.select("push_send"), adapter);
  assert.equal(registry.get("ntfy"), adapter);
  assert.throws(() => registry.select("voice_call"), UnsupportedCapabilityError);
});

// --- Error classification ---------------------------------------------------

test("mapPushError: 429/5xx and network errors are retriable; an invalid/stale token (401/403) is permanent", () => {
  assert.equal(mapPushError({ httpStatus: 429 }).retriable, true);
  assert.equal(mapPushError({ httpStatus: 503 }).retriable, true);
  // A rejected/stale access token surfaces as a permanent, caller-safe failure.
  assert.equal(mapPushError({ httpStatus: 401 }).retriable, false);
  assert.equal(mapPushError({ httpStatus: 403 }).retriable, false);
  assert.equal(mapPushError({ code: "ETIMEDOUT" }).retriable, true);
  assert.equal(mapPushError(new Error("unknown")).retriable, false);
});
