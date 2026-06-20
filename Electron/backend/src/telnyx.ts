import { createPublicKey, verify } from "node:crypto";
import { normalizeNumber } from "./phone";
import { ChannelAdapter, ChannelCapabilities, DeliveryStatusUpdate, InboundMessage, OutboundMessage, SendResult } from "./channels";

// Telnyx SMS/MMS edge adapter (work item 015, CLV-007). Telnyx differs from
// Twilio: a Bearer-token JSON API, JSON webhook events, and Ed25519-signed
// webhooks. Everything is normalized into the provider-neutral contracts.

export interface TelnyxConfig {
  apiKey: string;
  phoneNumber: string;
  publicKey: string;       // base64 Ed25519 public key from the Telnyx portal
  profileId: string;
}

export function loadTelnyxConfig(): TelnyxConfig {
  return {
    apiKey: (process.env.TELNYX_API_KEY || "").trim(),
    phoneNumber: (process.env.TELNYX_PHONE_NUMBER || "").trim(),
    publicKey: (process.env.TELNYX_PUBLIC_KEY || "").trim(),
    profileId: (process.env.TELNYX_MESSAGING_PROFILE_ID || "").trim()
  };
}

export async function sendTelnyxMessage(toValue: string, body: string, mediaUrls: string[]): Promise<Record<string, unknown>> {
  const config = loadTelnyxConfig();
  if (!config.apiKey || !config.phoneNumber) throw new Error("Set TELNYX_API_KEY and TELNYX_PHONE_NUMBER.");
  const payload: Record<string, unknown> = { from: config.phoneNumber, to: normalizeNumber(toValue), text: body };
  if (mediaUrls.length) payload.media_urls = mediaUrls;
  if (config.profileId) payload.messaging_profile_id = config.profileId;
  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });
  const json = await response.json() as { data?: Record<string, unknown> };
  if (!response.ok) throw new Error(`Telnyx rejected the message (${response.status}).`);
  return json.data ?? (json as Record<string, unknown>);
}

// Ed25519 verification of `${timestamp}|${rawBody}` against the base64 raw key.
export function validateTelnyxSignature(rawBody: string, timestamp: string, signatureB64: string, publicKeyB64: string): boolean {
  if (!timestamp || !signatureB64 || !publicKeyB64) return false;
  try {
    const signed = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    const signature = Buffer.from(signatureB64, "base64");
    const rawKey = Buffer.from(publicKeyB64, "base64");
    // Wrap the 32-byte Ed25519 key as SPKI DER (fixed prefix) so createPublicKey accepts it.
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawKey]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verify(null, signed, key, signature);
  } catch {
    return false;
  }
}

interface TelnyxEvent {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      text?: string;
      from?: { phone_number?: string };
      to?: Array<{ phone_number?: string; status?: string }>;
      media?: Array<{ url?: string; content_type?: string }>;
    };
  };
}

export function parseTelnyxInbound(event: unknown): InboundMessage {
  const payload = (event as TelnyxEvent)?.data?.payload ?? {};
  const mediaUrls = Array.isArray(payload.media) ? payload.media.map((m) => String(m.url || "")).filter(Boolean) : [];
  return {
    from: payload.from?.phone_number || "",
    to: payload.to?.[0]?.phone_number || "",
    body: payload.text || "",
    mediaUrls,
    providerMessageId: payload.id || null
  };
}

export function parseTelnyxStatus(event: unknown): DeliveryStatusUpdate {
  const data = (event as TelnyxEvent)?.data ?? {};
  const payload = data.payload ?? {};
  return { providerMessageId: payload.id || "", status: payload.to?.[0]?.status || data.event_type || "" };
}

const TELNYX_CAPABILITIES: ChannelCapabilities = {
  kind: "sms_mms_edge",
  provider: "telnyx",
  displayName: "Telnyx",
  capabilities: ["sms_send", "mms_send", "inbound_sms", "delivery_status", "media"]
};

export function createTelnyxAdapter(sender: typeof sendTelnyxMessage = sendTelnyxMessage): ChannelAdapter {
  return {
    capabilities: () => TELNYX_CAPABILITIES,
    supports: (capability) => TELNYX_CAPABILITIES.capabilities.includes(capability),
    validateCredentials: async () => {
      const config = loadTelnyxConfig();
      const ok = Boolean(config.apiKey && config.phoneNumber);
      return ok ? { ok, phoneNumber: config.phoneNumber } : { ok, error: "Telnyx API key and phone number are required." };
    },
    send: async (message: OutboundMessage): Promise<SendResult> => {
      const raw = await sender(message.to, message.body, message.mediaUrls || []);
      const id = raw.id;
      const to = raw.to as Array<{ status?: string }> | undefined;
      return { providerMessageId: id ? String(id) : null, status: String(to?.[0]?.status || "queued"), raw };
    },
    parseInbound: (payload) => parseTelnyxInbound(payload),
    parseStatus: (payload) => parseTelnyxStatus(payload)
  };
}
