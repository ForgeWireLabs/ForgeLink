import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeNumber } from "./phone";
import {
  CallStatus,
  CallStatusUpdate,
  ChannelAdapter,
  ChannelCapabilities,
  DeliveryStatusUpdate,
  EndCallResult,
  InboundCallEvent,
  InboundMessage,
  OutboundCallRequest,
  OutboundMessage,
  SendResult,
  StartCallResult
} from "./channels";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  publicBaseUrl: string;
}

export function loadTwilioConfig(): TwilioConfig {
  return {
    accountSid: (process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: (process.env.TWILIO_AUTH_TOKEN || "").trim(),
    phoneNumber: (process.env.TWILIO_PHONE_NUMBER || "").trim(),
    publicBaseUrl: (process.env.TWILIO_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "")
  };
}

export async function sendTwilioMessage(toValue: string, body: string, mediaUrls: string[]): Promise<Record<string, unknown>> {
  const config = loadTwilioConfig();
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    throw new Error("Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.");
  }
  const fields = new URLSearchParams({ To: normalizeNumber(toValue), From: normalizeNumber(config.phoneNumber), Body: body });
  for (const url of mediaUrls) fields.append("MediaUrl", url);
  if (config.publicBaseUrl) fields.set("StatusCallback", `${config.publicBaseUrl}/webhooks/status`);
  const authorization = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: fields,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Twilio rejected the message (${response.status}).`);
  return payload;
}

function twilioAuthorization(config: TwilioConfig): string {
  return Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
}

function requireTwilioVoiceConfig(): TwilioConfig {
  const config = loadTwilioConfig();
  if (!config.accountSid || !config.authToken || !config.phoneNumber || !config.publicBaseUrl) {
    throw new Error("Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and TWILIO_PUBLIC_BASE_URL.");
  }
  return config;
}

export async function startTwilioCall(request: OutboundCallRequest): Promise<Record<string, unknown>> {
  const config = requireTwilioVoiceConfig();
  const fields = new URLSearchParams({
    To: normalizeNumber(request.to),
    From: normalizeNumber(request.from || config.phoneNumber),
    Url: `${config.publicBaseUrl}/webhooks/voice/twiml`,
    Method: "POST",
    StatusCallback: `${config.publicBaseUrl}/webhooks/voice/status`,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed"
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${twilioAuthorization(config)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: fields,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Twilio rejected the call (${response.status}).`);
  return payload;
}

export async function endTwilioCall(providerCallId: string): Promise<Record<string, unknown>> {
  const config = requireTwilioVoiceConfig();
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${encodeURIComponent(providerCallId)}.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${twilioAuthorization(config)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Status: "completed" }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Twilio rejected the call update (${response.status}).`);
  return payload;
}

export function validateTwilioSignature(pathname: string, fields: Record<string, string>, signature: string): boolean {
  const config = loadTwilioConfig();
  if (!config.authToken || !config.publicBaseUrl || !signature) return false;
  const value = `${config.publicBaseUrl}${pathname}${Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join("")}`;
  const expected = createHmac("sha1", config.authToken).update(value).digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

// --- Channel adapter (work item 015, CLV-003) ---------------------------------
// Normalize Twilio's form-encoded webhook payloads into the provider-neutral
// contracts so the rest of the app never touches Twilio-specific field names.

export function parseTwilioInbound(fields: Record<string, string>): InboundMessage {
  const mediaUrls = Object.keys(fields).filter((key) => key.startsWith("MediaUrl")).sort().map((key) => fields[key]);
  return { from: fields.From || "", to: fields.To || "", body: fields.Body || "", mediaUrls, providerMessageId: fields.MessageSid || null };
}

export function parseTwilioStatus(fields: Record<string, string>): DeliveryStatusUpdate {
  return { providerMessageId: fields.MessageSid || "", status: fields.MessageStatus || "" };
}

export function normalizeTwilioCallStatus(status: string): CallStatus {
  const normalized = status.toLowerCase().replace(/-/g, "_");
  if (normalized === "initiated") return "queued";
  if (normalized === "in_progress" || normalized === "answered") return "in_progress";
  if (normalized === "no_answer") return "no_answer";
  if (["queued", "ringing", "completed", "failed", "busy", "canceled"].includes(normalized)) return normalized as CallStatus;
  return "failed";
}

export function parseTwilioInboundCall(fields: Record<string, string>): InboundCallEvent {
  return {
    providerCallId: fields.CallSid || null,
    direction: "inbound",
    from: fields.From || "",
    to: fields.To || "",
    status: normalizeTwilioCallStatus(fields.CallStatus || "ringing"),
    occurredAt: fields.Timestamp || undefined
  };
}

export function parseTwilioCallStatus(fields: Record<string, string>): CallStatusUpdate {
  const duration = fields.CallDuration ? Number(fields.CallDuration) : null;
  return {
    providerCallId: fields.CallSid || "",
    status: normalizeTwilioCallStatus(fields.CallStatus || ""),
    startedAt: fields.StartTime || null,
    answeredAt: fields.CallStatus === "in-progress" ? (fields.Timestamp || null) : null,
    endedAt: ["completed", "failed", "busy", "no-answer", "canceled"].includes(fields.CallStatus || "") ? (fields.Timestamp || null) : null,
    durationSeconds: Number.isFinite(duration) ? duration : null
  };
}

const TWILIO_CAPABILITIES: ChannelCapabilities = {
  kind: "sms_mms_edge",
  provider: "twilio",
  displayName: "Twilio",
  capabilities: ["sms_send", "mms_send", "inbound_sms", "delivery_status", "media"]
};

// The adapter delegates outbound send to the provided sender (defaults to the
// real Twilio call), preserving the existing injectable send seam and behaviour.
export function createTwilioAdapter(sender: typeof sendTwilioMessage = sendTwilioMessage): ChannelAdapter {
  return {
    capabilities: () => TWILIO_CAPABILITIES,
    supports: (capability) => TWILIO_CAPABILITIES.capabilities.includes(capability),
    validateCredentials: async () => {
      const config = loadTwilioConfig();
      const ok = Boolean(config.accountSid && config.authToken && config.phoneNumber);
      return ok ? { ok, phoneNumber: config.phoneNumber } : { ok, error: "Twilio account SID, auth token, and phone number are required." };
    },
    send: async (message: OutboundMessage): Promise<SendResult> => {
      const raw = await sender(message.to, message.body, message.mediaUrls || []);
      return { providerMessageId: raw.sid ? String(raw.sid) : null, status: String(raw.status || "queued"), raw };
    },
    parseInbound: (payload) => parseTwilioInbound(payload as Record<string, string>),
    parseStatus: (payload) => parseTwilioStatus(payload as Record<string, string>)
  };
}

const TWILIO_VOICE_CAPABILITIES: ChannelCapabilities = {
  kind: "voice_edge",
  provider: "twilio",
  displayName: "Twilio Voice",
  capabilities: ["voice_call", "voice_start", "voice_end", "voice_status", "inbound_call"]
};

export function createTwilioVoiceAdapter(
  starter: typeof startTwilioCall = startTwilioCall,
  ender: typeof endTwilioCall = endTwilioCall
): ChannelAdapter {
  return {
    capabilities: () => TWILIO_VOICE_CAPABILITIES,
    supports: (capability) => TWILIO_VOICE_CAPABILITIES.capabilities.includes(capability),
    validateCredentials: async () => {
      const config = loadTwilioConfig();
      const ok = Boolean(config.accountSid && config.authToken && config.phoneNumber && config.publicBaseUrl);
      return ok ? { ok, phoneNumber: config.phoneNumber } : { ok, error: "Twilio voice requires account SID, auth token, phone number, and public base URL." };
    },
    send: async () => { throw new Error("Twilio Voice does not send messages."); },
    voiceAvailability: async () => {
      const config = loadTwilioConfig();
      const ok = Boolean(config.accountSid && config.authToken && config.phoneNumber && config.publicBaseUrl);
      return ok ? { available: true, provider: "twilio" } : { available: false, provider: "twilio", reason: "missing_credentials", message: "Twilio voice requires account SID, auth token, phone number, and public base URL." };
    },
    startCall: async (request): Promise<StartCallResult> => {
      const raw = await starter(request);
      return { providerCallId: raw.sid ? String(raw.sid) : null, status: normalizeTwilioCallStatus(String(raw.status || "queued")), raw };
    },
    endCall: async (providerCallId): Promise<EndCallResult> => {
      const raw = await ender(providerCallId);
      return { providerCallId: raw.sid ? String(raw.sid) : providerCallId, status: normalizeTwilioCallStatus(String(raw.status || "completed")), raw };
    },
    parseInboundCall: (payload) => parseTwilioInboundCall(payload as Record<string, string>),
    parseCallStatus: (payload) => parseTwilioCallStatus(payload as Record<string, string>)
  };
}
