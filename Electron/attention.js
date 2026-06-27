const DEFAULT_ATTENTION_POLICY = {
  enabled: true,
  operator_mode: "available",
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_allow_urgent: false,
  redact_notification_bodies: true,
  sms_notifications: "all",
  agent_notifications: "high_and_urgent",
  signal_notifications: "off",
  system_notifications: "all",
  emergency_contact_bypass: true,
  emergency_agent_requires_policy: true,
  presence_enabled: true,
  presence_app_focus: "unknown",
  presence_input: "unknown",
  presence_network: "unknown",
  presence_do_not_disturb: false,
  presence_paired_mobile: "unknown",
  muted_sources: []
};

const URGENCY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };
const OPERATOR_MODES = new Set(["available", "focus", "driving", "sleeping", "family", "work", "emergency_only", "offline"]);

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
  policy.operator_mode = OPERATOR_MODES.has(String(policy.operator_mode)) ? String(policy.operator_mode) : DEFAULT_ATTENTION_POLICY.operator_mode;
  policy.quiet_hours_enabled = policy.quiet_hours_enabled === true;
  policy.quiet_hours_allow_urgent = policy.quiet_hours_allow_urgent === true;
  policy.redact_notification_bodies = policy.redact_notification_bodies !== false;
  policy.emergency_contact_bypass = policy.emergency_contact_bypass !== false;
  policy.emergency_agent_requires_policy = policy.emergency_agent_requires_policy !== false;
  policy.presence_enabled = policy.presence_enabled !== false;
  policy.presence_app_focus = String(policy.presence_app_focus || DEFAULT_ATTENTION_POLICY.presence_app_focus).slice(0, 40);
  policy.presence_input = String(policy.presence_input || DEFAULT_ATTENTION_POLICY.presence_input).slice(0, 40);
  policy.presence_network = String(policy.presence_network || DEFAULT_ATTENTION_POLICY.presence_network).slice(0, 40);
  policy.presence_do_not_disturb = policy.presence_do_not_disturb === true;
  policy.presence_paired_mobile = String(policy.presence_paired_mobile || DEFAULT_ATTENTION_POLICY.presence_paired_mobile).slice(0, 40);
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

function modeDecision(policy, event) {
  const urgencyRank = URGENCY_RANK[String(event.urgency || "normal")] ?? URGENCY_RANK.normal;
  const emergency = event.emergency === true || event.required_authority === "emergency" || event.risk === "emergency" || event.risk === "critical";
  if (policy.operator_mode === "available") return null;
  if (policy.operator_mode === "offline") return emergency ? null : { notify: false, reason: "operator_offline" };
  if (policy.operator_mode === "emergency_only") return emergency ? null : { notify: false, reason: "emergency_only" };
  if (policy.operator_mode === "sleeping") return urgencyRank >= URGENCY_RANK.urgent || emergency ? null : { notify: false, reason: "sleeping_mode" };
  if (policy.operator_mode === "driving") return urgencyRank >= URGENCY_RANK.urgent || emergency ? null : { notify: false, reason: "driving_mode" };
  if (policy.operator_mode === "focus") return urgencyRank >= URGENCY_RANK.high || emergency ? null : { notify: false, reason: "focus_mode" };
  if (policy.operator_mode === "family" || policy.operator_mode === "work") return urgencyRank >= URGENCY_RANK.high || emergency ? null : { notify: false, reason: `${policy.operator_mode}_mode` };
  return null;
}

function presenceDecision(policy, event) {
  if (!policy.presence_enabled) return null;
  const urgencyRank = URGENCY_RANK[String(event.urgency || "normal")] ?? URGENCY_RANK.normal;
  const emergency = event.emergency === true || event.required_authority === "emergency" || event.risk === "emergency" || event.risk === "critical";
  if (policy.presence_do_not_disturb && urgencyRank < URGENCY_RANK.urgent && !emergency) return { notify: false, reason: "presence_do_not_disturb" };
  if (policy.presence_app_focus === "unfocused" && event.kind === "signal") return { notify: false, reason: "presence_unfocused_signal" };
  return null;
}

function escalationFor(policy, event) {
  const emergency = event.emergency === true || event.required_authority === "emergency" || event.risk === "emergency" || event.risk === "critical";
  if (emergency) return policy.emergency_contact_bypass ? "emergency_bypass_enabled" : "operator_only";
  if (policy.operator_mode === "focus" || policy.operator_mode === "sleeping" || policy.operator_mode === "driving") return "defer_or_batch";
  if (policy.operator_mode === "offline") return "record_only";
  return "standard";
}

function batchingFor(policy, event) {
  const urgencyRank = URGENCY_RANK[String(event.urgency || "normal")] ?? URGENCY_RANK.normal;
  if (event.emergency === true || event.required_authority === "emergency" || urgencyRank >= URGENCY_RANK.urgent) return "send_now";
  if (["focus", "sleeping", "driving", "family", "work", "offline"].includes(policy.operator_mode)) return "batch_or_defer";
  return "standard";
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
  const emergencyClaim = event.emergency === true || event.required_authority === "emergency" || event.risk === "emergency" || event.risk === "critical";
  if (event.kind === "agent" && event.emergency === true && policy.emergency_agent_requires_policy && event.required_authority !== "emergency" && event.risk !== "emergency" && event.risk !== "critical") return { notify: false, reason: "emergency_policy_required" };
  const mode = modeDecision(policy, event);
  if (mode) return { ...mode, operator_mode: policy.operator_mode, escalation: escalationFor(policy, event), batching: batchingFor(policy, event) };
  const presence = presenceDecision(policy, event);
  if (presence) return { ...presence, operator_mode: policy.operator_mode, escalation: escalationFor(policy, event), batching: batchingFor(policy, event) };
  const urgent = event.urgency === "urgent";
  if (inQuietHours(policy, now) && !(urgent && policy.quiet_hours_allow_urgent) && !emergencyClaim) return { notify: false, reason: "quiet_hours", operator_mode: policy.operator_mode, escalation: escalationFor(policy, event), batching: batchingFor(policy, event) };
  if (!kindAllowed(policy, event)) return { notify: false, reason: "kind_policy" };
  const shouldRedact = policy.redact_notification_bodies || policy.operator_mode !== "available";
  const title = shouldRedact ? redactedTitle(event) : scrub(event.title || redactedTitle(event));
  const body = shouldRedact ? redactedBody(event) : scrub(event.body || redactedBody(event));
  return { notify: true, reason: "allowed", title, body, operator_mode: policy.operator_mode, escalation: escalationFor(policy, event), batching: batchingFor(policy, event) };
}

module.exports = { DEFAULT_ATTENTION_POLICY, evaluateAttention, inQuietHours, normalizeAttentionPolicy, scrub };
