import type { ConfigStatus, SmsProviderSettingsStatus } from "./types";

export type SmsProviderId = "twilio" | "telnyx";

export interface ProviderCapability {
  id: "sms" | "mms" | "voice" | "signed_webhooks";
  label: string;
  supported: boolean;
}

export interface SmsProviderExperience {
  id: SmsProviderId;
  label: "Twilio" | "Telnyx";
  configured: boolean;
  inboundConfigured: boolean;
  setupModel: string;
  webhookModel: string;
  capabilities: ProviderCapability[];
}

export interface CommunicationsProviderExperience {
  selected: SmsProviderExperience;
  twilio: SmsProviderExperience;
  telnyx: SmsProviderExperience;
  smsReady: boolean;
}

const capabilities = (provider: SmsProviderId): ProviderCapability[] => [
  { id: "sms", label: "SMS", supported: true },
  { id: "mms", label: "MMS", supported: true },
  { id: "voice", label: "Voice", supported: provider === "twilio" },
  { id: "signed_webhooks", label: provider === "twilio" ? "Twilio-signed webhooks" : "Ed25519 webhooks", supported: true },
];

export function buildCommunicationsProviderExperience(
  config?: ConfigStatus,
  settings?: SmsProviderSettingsStatus,
  twilioDesktopConfigured = false,
): CommunicationsProviderExperience {
  const twilioReported = config?.sms_providers?.twilio;
  const telnyxReported = config?.sms_providers?.telnyx;
  const twilioConfigured = Boolean(
    twilioReported?.configured ?? (twilioDesktopConfigured || (config?.account_sid && config?.auth_token && config?.phone_number)),
  );
  const twilioInbound = Boolean(twilioReported?.inbound_configured ?? (twilioConfigured && config?.public_base_url));
  const telnyxConfigured = Boolean(settings?.telnyx.configured ?? telnyxReported?.configured);
  const telnyxInbound = Boolean(settings?.telnyx.inbound_configured ?? telnyxReported?.inbound_configured);
  const selectedId: SmsProviderId = settings?.preferred_provider || config?.sms_provider || "twilio";

  const twilio: SmsProviderExperience = {
    id: "twilio",
    label: "Twilio",
    configured: twilioConfigured,
    inboundConfigured: twilioInbound,
    setupModel: "Account SID, Auth Token, and an SMS-capable phone number",
    webhookModel: "Per-number SMS/MMS webhook plus Twilio request signatures",
    capabilities: capabilities("twilio"),
  };
  const telnyx: SmsProviderExperience = {
    id: "telnyx",
    label: "Telnyx",
    configured: telnyxConfigured,
    inboundConfigured: telnyxInbound,
    setupModel: "API v2 key, messaging phone number, messaging profile, and Ed25519 public key",
    webhookModel: "Messaging-profile webhook v2 plus Ed25519 signatures",
    capabilities: capabilities("telnyx"),
  };
  const selected = selectedId === "telnyx" ? telnyx : twilio;
  return { selected, twilio, telnyx, smsReady: selected.configured };
}
