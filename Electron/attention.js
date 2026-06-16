const DEFAULT_ATTENTION_POLICY = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_allow_urgent: false,
  redact_notification_bodies: true,
  sms_notifications: "all",
  agent_notifications: "high_and_urgent",
  signal_notifications: "off",
  system_notifications: "all",
  muted_sources: []
};

const URGENCY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };

function minutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

function inQuietHours(policy, now = new Date()) {
  if (!policy.quiet_hours_enabled) return false;
  const start = minutes(policy.quiet_hours_start);
  const end = minutes(policy.quiet_hours_end);
  const current = now.getHours() * 60 + now.getMinutes();
  return start === end ? true : start < end ? current >= start && current < end : current >= start || current < end;
}

function normalizeAttentionPolicy(value = {}) {
  const policy = { ...DEFAULT_ATTENTION_POLICY, ...(value || {}) };
  policy.enabled = policy.enabled !== false;
  policy.quiet_hours_enabled = policy.quiet_hours_enabled === true;
  policy.quiet_hours_allow_urgent = policy.quiet_hours_allow_urgent === true;
  policy.redact_notification_bodies = policy.redact_notification_bodies !== false;
  policy.muted_sources = Array.isArray(policy.muted_sources) ? policy.muted_sources.map(String).map(item => item.trim()).filter(Boolean).slice(0, 100) : [];
  for (const key of ["sms_notifications", "agent_notifications", "signal_notifications", "system_notifications"]) {
    policy[key] = String(policy[key] || DEFAULT_ATTENTION_POLICY[key]);
  }
  if (!["all", "off"].includes(policy.sms_notifications)) policy.sms_notifications = DEFAULT_ATTENTION_POLICY.sms_notifications;
  if (!["all", "high_and_urgent", "urgent_only", "off"].includes(policy.agent_notifications)) policy.agent_notifications = DEFAULT_ATTENTION_POLICY.agent_notifications;
  if (!["all", "off"].includes(policy.signal_notifications)) policy.signal_notifications = DEFAULT_ATTENTION_POLICY.signal_notifications;
  if (!["all", "failures_only", "off"].includes(policy.system_notifications)) policy.system_notifications = DEFAULT_ATTENTION_POLICY.system_notifications;
  return policy;
}

function scrub(value = "") {
  return String(value || "")
    .replace(/\bAC[a-fA-F0-9]{32}\b/g, "[redacted]")
    .replace(/\bfl(?:mcp|chan)_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .slice(0, 180);
}

function sourceMuted(policy, event) {
  const values = [event.source, event.channel_id, event.source_title, event.thread_id].filter(Boolean).map(String);
  return values.some(value => policy.muted_sources.includes(value));
}

function kindAllowed(policy, event) {
  const kind = String(event.kind || "system");
  const urgency = String(event.urgency || "normal");
  if (kind === "sms") return policy.sms_notifications === "all";
  if (kind === "agent") {
    if (policy.agent_notifications === "off") return false;
    if (policy.agent_notifications === "all") return true;
    if (policy.agent_notifications === "urgent_only") return urgency === "urgent";
    return (URGENCY_RANK[urgency] ?? 1) >= URGENCY_RANK.high;
  }
  if (kind === "signal") return policy.signal_notifications === "all";
  if (policy.system_notifications === "off") return false;
  if (policy.system_notifications === "failures_only") return event.category === "failure";
  return true;
}

function redactedTitle(event) {
  if (event.kind === "sms") return "New message";
  if (event.kind === "agent") return (event.urgency === "urgent" || event.urgency === "high") ? "Important agent update" : "Agent channel update";
  if (event.kind === "signal") return "Signal update";
  return scrub(event.title || "ForgeLink");
}

function redactedBody(event) {
  if (event.kind === "sms") return "A conversation has a new message.";
  if (event.kind === "agent") return event.source ? `From ${scrub(event.source)}.` : "A local agent needs attention.";
  if (event.kind === "signal") return event.source_title ? `From ${scrub(event.source_title)}.` : "A trusted signal has an update.";
  return event.category === "failure" ? "A local action needs attention." : "ForgeLink has an update.";
}

function evaluateAttention(policyValue, eventValue, now = new Date()) {
  const policy = normalizeAttentionPolicy(policyValue);
  const event = { kind: "system", urgency: "normal", category: "info", ...(eventValue || {}) };
  if (!policy.enabled) return { notify: false, reason: "disabled" };
  if (sourceMuted(policy, event)) return { notify: false, reason: "muted_source" };
  const urgent = event.urgency === "urgent";
  if (inQuietHours(policy, now) && !(urgent && policy.quiet_hours_allow_urgent)) return { notify: false, reason: "quiet_hours" };
  if (!kindAllowed(policy, event)) return { notify: false, reason: "kind_policy" };
  const title = policy.redact_notification_bodies ? redactedTitle(event) : scrub(event.title || redactedTitle(event));
  const body = policy.redact_notification_bodies ? redactedBody(event) : scrub(event.body || redactedBody(event));
  return { notify: true, reason: "allowed", title, body };
}

module.exports = { DEFAULT_ATTENTION_POLICY, evaluateAttention, inQuietHours, normalizeAttentionPolicy, scrub };
