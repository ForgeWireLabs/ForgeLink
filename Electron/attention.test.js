const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_ATTENTION_POLICY, evaluateAttention, inQuietHours, normalizeAttentionPolicy, scrub } = require("./attention");

test("redacts SMS notification details by default", () => {
  const decision = evaluateAttention(DEFAULT_ATTENTION_POLICY, {
    kind: "sms",
    title: "Message from +15551234567",
    body: "Meet at https://example.com/private with AC1234567890abcdef1234567890abcdef"
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.title, "New message");
  assert.equal(decision.body, "A conversation has a new message.");
});

test("allows only high and urgent agent messages by default", () => {
  assert.equal(evaluateAttention(DEFAULT_ATTENTION_POLICY, { kind: "agent", urgency: "normal", source: "forgewire" }).notify, false);
  const high = evaluateAttention(DEFAULT_ATTENTION_POLICY, { kind: "agent", urgency: "high", source: "forgewire" });
  assert.equal(high.notify, true);
  assert.equal(high.title, "Important agent update");
  assert.equal(high.body, "From forgewire.");
});

test("keeps trusted signals silent unless explicitly enabled", () => {
  assert.equal(evaluateAttention(DEFAULT_ATTENTION_POLICY, { kind: "signal", source_title: "ForgeWire Signals" }).notify, false);
  const decision = evaluateAttention({ ...DEFAULT_ATTENTION_POLICY, signal_notifications: "all" }, { kind: "signal", source_title: "ForgeWire Signals" });
  assert.equal(decision.notify, true);
  assert.equal(decision.body, "From ForgeWire Signals.");
});

test("mutes matching source and channel identifiers", () => {
  const policy = { ...DEFAULT_ATTENTION_POLICY, signal_notifications: "all", muted_sources: ["forgewire", "sigsub-1"] };
  assert.equal(evaluateAttention(policy, { kind: "agent", urgency: "urgent", channel_id: "forgewire" }).reason, "muted_source");
  assert.equal(evaluateAttention(policy, { kind: "signal", source: "sigsub-1" }).reason, "muted_source");
});

test("quiet hours suppress notifications unless urgent override is enabled", () => {
  const policy = { ...DEFAULT_ATTENTION_POLICY, quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "07:00" };
  const late = new Date("2026-06-16T23:30:00");
  assert.equal(inQuietHours(policy, late), true);
  assert.equal(evaluateAttention(policy, { kind: "sms" }, late).reason, "quiet_hours");
  const urgent = evaluateAttention({ ...policy, quiet_hours_allow_urgent: true }, { kind: "agent", urgency: "urgent" }, late);
  assert.equal(urgent.notify, true);
});

test("scrubs sensitive values even when notification body text is enabled", () => {
  const policy = { ...DEFAULT_ATTENTION_POLICY, redact_notification_bodies: false };
  const decision = evaluateAttention(policy, {
    kind: "system",
    title: "Saved flmcp_secretToken",
    body: "Validated +15551234567 at https://example.com/private"
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.title, "Saved [redacted]");
  assert.equal(decision.body, "Validated [redacted] at [link]");
});

test("supports failure-only system notifications", () => {
  const policy = { ...DEFAULT_ATTENTION_POLICY, system_notifications: "failures_only" };
  assert.equal(evaluateAttention(policy, { kind: "system", category: "info" }).notify, false);
  assert.equal(evaluateAttention(policy, { kind: "system", category: "failure" }).notify, true);
});

test("normalizes unsupported policy values back to private defaults", () => {
  const policy = normalizeAttentionPolicy({ enabled: false, signal_notifications: "popular", muted_sources: [" a ", "", "b"] });
  assert.equal(policy.enabled, false);
  assert.equal(policy.signal_notifications, "off");
  assert.deepEqual(policy.muted_sources, ["a", "b"]);
});

test("scrub bounds exposed text", () => {
  assert.equal(scrub("x".repeat(300)).length, 180);
});
