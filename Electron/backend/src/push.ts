import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { ChannelAdapter, ChannelCapabilities, CredentialValidation, OutboundMessage, SendResult } from "./channels";

// Provider-neutral push notification channel (work item 019, PUSH-001/002/004).
//
// Push is a NOTIFICATION path, not a replacement for the local app or the future
// first-party mobile companion. It alerts an operator that something needs them;
// it never carries the private communication state itself. ForgeLink owns the
// data, the push provider is a dumb edge, and what leaves the device is decided by
// a redaction profile (PUSH-004) that defaults to lock-screen-safe.
//
// Provider strategy (PUSH-002, see docs/push-channel.md): the shipped path is
// ntfy (ntfy.sh or a self-hosted instance) — a topic-based pub/sub notifier that
// needs no per-user account and can be fully self-hosted, which fits ForgeLink's
// local-first boundary. The contracts here are not coupled to ntfy; another
// provider can implement PushTransport without touching the rest of the channel.
//
// Determinism: the adapter sends through an injectable transport, so tests never
// reach a real push server. The default transport (sendNtfyPush) is operator-
// verified live (deferred, see docs/push-channel.md); the parts ForgeLink relies on
// — redaction, validation, error classification, send orchestration — are pure and
// unit-tested.

export const PUSH_LIMITS = {
  maxTitle: 120,
  maxBody: 400,
  maxTopic: 64,
  maxRef: 64
};

// Named priorities map to ntfy's priority header; other providers map as needed.
export type PushPriority = "min" | "low" | "default" | "high" | "urgent";
const PUSH_PRIORITIES = new Set<PushPriority>(["min", "low", "default", "high", "urgent"]);

// Redaction profiles (PUSH-004). lock_screen_safe is the default and the only
// profile safe to send to a third-party provider without an explicit policy
// opt-in; full includes caller-provided content and must be chosen deliberately.
export type PushRedactionProfile = "lock_screen_safe" | "full";
const PUSH_PROFILES = new Set<PushRedactionProfile>(["lock_screen_safe", "full"]);

export type PushCategory = "approval" | "message" | "alert" | "system";

export interface PushConfig {
  provider: string;       // "ntfy" for the shipped path
  baseUrl: string;        // e.g. https://ntfy.sh or a self-hosted instance
  topic: string;          // delivery identity (ntfy topic); empty => disabled
  token: string;          // optional bearer token for access-controlled topics
  defaultProfile: PushRedactionProfile;
}

// A push request from ForgeLink's side, BEFORE redaction. It may carry sensitive
// source material (title/body); redaction decides what actually leaves the device.
export interface PushNotification {
  title?: string;
  body?: string;
  category?: PushCategory;     // classification so safe text can be derived
  ref?: string;                // opaque local correlation id (e.g. pending request id); no private content
  priority?: PushPriority;
}

// What actually goes on the wire after redaction. Provider-neutral.
export interface RedactedPush {
  title: string;
  body: string;
  topic: string;
  priority: PushPriority;
  ref?: string;
}

// Optional signed action response contract (PUSH-001). Push is notification-only in
// this slice; if quick actions ever ship (PUSH-005) a tapped action returns this
// shape and the server enforces signature/expiry/replay/pending/policy before
// applying anything — taps are never authority on their own.
export interface PushActionResponse {
  rid: string;       // pending request id the action refers to
  action: string;    // approve | deny | dismiss | ...
  nonce: string;     // anti-replay
  exp: number;       // expiry (ms epoch)
  signature: string; // HMAC over the payload
}

export type PushTransport = (payload: RedactedPush, config: PushConfig) => Promise<{ providerMessageId: string | null }>;

export function normalizePushProfile(value: unknown): PushRedactionProfile {
  const raw = String(value ?? "").trim().toLowerCase();
  // Default safe: anything not an explicit, recognized profile falls back to
  // lock-screen-safe so private content is never sent by misconfiguration.
  return PUSH_PROFILES.has(raw as PushRedactionProfile) ? (raw as PushRedactionProfile) : "lock_screen_safe";
}

export function loadPushConfig(): PushConfig {
  return {
    provider: (process.env.FORGELINK_PUSH_PROVIDER || "ntfy").trim() || "ntfy",
    baseUrl: (process.env.FORGELINK_PUSH_URL || "https://ntfy.sh").trim().replace(/\/+$/, ""),
    topic: (process.env.FORGELINK_PUSH_TOPIC || "").trim(),
    token: process.env.FORGELINK_PUSH_TOKEN || "",
    defaultProfile: normalizePushProfile(process.env.FORGELINK_PUSH_PROFILE)
  };
}

// Disabled by default: with no topic configured the channel is off and send throws.
export function pushConfigured(config: PushConfig = loadPushConfig()): boolean {
  return Boolean(config.baseUrl && config.topic);
}

// Generic, non-identifying text per category. Used as-is under lock_screen_safe and
// as the fallback when full content is empty.
const SAFE_TEXT: Record<PushCategory, { title: string; body: string }> = {
  approval: { title: "ForgeLink", body: "An approval is waiting in ForgeLink." },
  message: { title: "ForgeLink", body: "You have a new message in ForgeLink." },
  alert: { title: "ForgeLink", body: "ForgeLink needs your attention." },
  system: { title: "ForgeLink", body: "ForgeLink status update." }
};

// Drop control characters and newlines (header-injection safe), collapse runs of
// spaces, and clamp length. Implemented with a char-code scan rather than a
// control-character regex literal so the source carries no raw control bytes.
function clampLine(value: unknown, max: number): string {
  const input = String(value ?? "");
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? " " : input[i];
  }
  return out.replace(/ +/g, " ").trim().slice(0, max);
}

function normalizePriority(value: unknown): PushPriority {
  const raw = String(value ?? "").trim().toLowerCase() as PushPriority;
  return PUSH_PRIORITIES.has(raw) ? raw : "default";
}

// A correlation ref must be an opaque, bounded token: no whitespace, no private
// content. The caller owns its meaning; we only guarantee it is transport-safe.
function sanitizeRef(value: unknown): string | undefined {
  const ref = String(value ?? "").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, PUSH_LIMITS.maxRef);
  return ref || undefined;
}

// Apply the redaction profile (PUSH-004). lock_screen_safe NEVER emits caller text;
// full emits clamped, control-stripped caller text and only happens when the config
// profile is explicitly "full".
export function redactPush(notification: PushNotification, config: PushConfig): RedactedPush {
  const profile = normalizePushProfile(config.defaultProfile);
  const category: PushCategory = notification.category && SAFE_TEXT[notification.category] ? notification.category : "alert";
  const priority = normalizePriority(notification.priority);
  const ref = sanitizeRef(notification.ref);
  if (profile === "full") {
    const title = clampLine(notification.title, PUSH_LIMITS.maxTitle) || SAFE_TEXT[category].title;
    const body = clampLine(notification.body, PUSH_LIMITS.maxBody) || SAFE_TEXT[category].body;
    return { title, body, topic: config.topic, priority, ref };
  }
  const safe = SAFE_TEXT[category];
  return { title: safe.title, body: safe.body, topic: config.topic, priority, ref };
}

// Classify a send failure as retryable (transient) or permanent. HTTP 429 and 5xx
// and network/transport errors are retryable; other 4xx are permanent.
export function mapPushError(error: unknown): { message: string; retriable: boolean } {
  const status = (error as { httpStatus?: number }).httpStatus;
  if (typeof status === "number") {
    if (status === 429 || status >= 500) return { message: `Push provider temporarily rejected the notification (${status}).`, retriable: true };
    return { message: `Push provider rejected the notification (${status}).`, retriable: false };
  }
  const code = (error as { code?: string }).code || "";
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "EPIPE"].includes(code)) {
    return { message: "Push delivery failed to reach the provider.", retriable: true };
  }
  return { message: "Push delivery failed.", retriable: false };
}

const PUSH_CAPABILITIES: ChannelCapabilities = {
  kind: "internet",
  provider: "ntfy",
  displayName: "Push",
  capabilities: ["push_send"]
};

// Default transport: publish to ntfy via a topic URL. Title/priority ride in
// headers (clamped/control-stripped upstream), the body is the request payload, and
// an optional bearer token authenticates access-controlled topics. Live behavior is
// operator-verified (deferred); tests inject a fake transport instead.
export const sendNtfyPush: PushTransport = (payload, config) => new Promise((resolve, reject) => {
  let url: URL;
  try { url = new URL(`${config.baseUrl}/${encodeURIComponent(payload.topic)}`); }
  catch { reject(new Error("Push provider URL is invalid.")); return; }
  const lib = url.protocol === "http:" ? httpRequest : httpsRequest;
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Title": payload.title,
    "Priority": payload.priority
  };
  if (payload.ref) headers["X-Forgelink-Ref"] = payload.ref;
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  const req = lib(url, { method: "POST", headers, timeout: 15_000 }, (res) => {
    const status = res.statusCode || 0;
    let raw = "";
    res.on("data", (chunk) => { if (raw.length < 8192) raw += chunk.toString("utf8"); });
    res.on("end", () => {
      if (status < 200 || status >= 300) { reject(Object.assign(new Error(`Push HTTP ${status}.`), { httpStatus: status })); return; }
      let providerMessageId: string | null = null;
      try { const parsed = JSON.parse(raw); if (parsed && typeof parsed.id === "string") providerMessageId = parsed.id; } catch { /* non-JSON ack is fine */ }
      resolve({ providerMessageId });
    });
  });
  req.on("timeout", () => { req.destroy(Object.assign(new Error("Push timeout."), { code: "ETIMEDOUT" })); });
  req.on("error", (error) => reject(Object.assign(error as Error, { code: (error as { code?: string }).code })));
  req.end(payload.body);
});

export function createPushAdapter(transport: PushTransport = sendNtfyPush): ChannelAdapter & { sendPush(notification: PushNotification): Promise<SendResult> } {
  const sendPush = async (notification: PushNotification): Promise<SendResult> => {
    const config = loadPushConfig();
    if (!pushConfigured(config)) throw new Error("Push notifications are not configured.");
    const redacted = redactPush(notification, config);
    try {
      const result = await transport(redacted, config);
      return { providerMessageId: result.providerMessageId, status: "sent", raw: { topic: redacted.topic, profile: config.defaultProfile } };
    } catch (error) {
      const mapped = mapPushError(error);
      throw Object.assign(new Error(mapped.message), { retriable: mapped.retriable });
    }
  };
  return {
    capabilities: () => PUSH_CAPABILITIES,
    supports: (capability) => PUSH_CAPABILITIES.capabilities.includes(capability),
    validateCredentials: async (): Promise<CredentialValidation> => {
      const config = loadPushConfig();
      return pushConfigured(config)
        ? { ok: true, accountName: `${config.provider}:${config.topic}` }
        : { ok: false, error: "Push requires a provider URL and a topic." };
    },
    // Generic registry send: a lock-screen-safe alert carrying no caller content
    // unless the configured profile is explicitly "full".
    send: async (message: OutboundMessage): Promise<SendResult> => sendPush({ body: message.body, category: "alert" }),
    sendPush
  };
}
