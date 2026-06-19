import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeNumber } from "./phone";
import { ChannelAdapter, ChannelCapabilities, DeliveryStatusUpdate, InboundMessage, OutboundMessage, SendResult } from "./channels";

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
    parseInbound: parseTwilioInbound,
    parseStatus: parseTwilioStatus
  };
}
