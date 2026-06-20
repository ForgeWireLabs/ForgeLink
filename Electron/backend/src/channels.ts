// Provider-neutral communication channel contracts (work item 015, CLV-002).
//
// ForgeLink's product center is governed human communication state, not any one
// provider. Channels are adapters: native (local desktop / agent), internet
// adapters (email, push, chat), and telecom edge adapters (SMS/MMS, voice). This
// module defines the contracts every adapter implements and a registry that
// discovers capabilities, selects a provider, and rejects unsupported
// capabilities cleanly. Existing Twilio behaviour is moved behind this boundary
// in a later slice (CLV-003); nothing here changes current messaging behaviour.

export type ChannelKind = "native" | "internet" | "sms_mms_edge" | "voice_edge";

export type Capability =
  | "local_delivery"
  | "sms_send"
  | "mms_send"
  | "inbound_sms"
  | "delivery_status"
  | "voice_call"
  | "voice_start"
  | "voice_end"
  | "voice_status"
  | "inbound_call"
  | "media";

export interface ChannelCapabilities {
  kind: ChannelKind;
  provider: string;        // "local" | "twilio" | "telnyx" | ...
  displayName: string;
  capabilities: Capability[];
}

export interface OutboundMessage {
  to: string;
  body: string;
  mediaUrls?: string[];
}

export interface SendResult {
  providerMessageId: string | null;
  status: string;          // queued | sent | delivered | failed | ...
  raw?: Record<string, unknown>;
}

// Normalized from a provider's inbound webhook payload.
export interface InboundMessage {
  from: string;
  to: string;
  body: string;
  mediaUrls: string[];
  providerMessageId: string | null;
}

// Normalized from a provider's delivery status callback.
export interface DeliveryStatusUpdate {
  providerMessageId: string;
  status: string;
}

export interface MediaRef {
  url: string;
  contentType?: string;
}

// Redacted, caller-safe error shape (never carries provider response bodies).
export interface ProviderError {
  message: string;
  retriable: boolean;
  providerStatus?: number;
}

export interface CredentialValidation {
  ok: boolean;
  accountName?: string;
  phoneNumber?: string;
  error?: string;
}

export type CallDirection = "inbound" | "outbound";

export type CallStatus =
  | "queued"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "busy"
  | "no_answer"
  | "canceled";

export type VoiceDisabledReason =
  | "not_configured"
  | "missing_credentials"
  | "unsupported_provider"
  | "provider_unavailable";

export interface VoiceAvailability {
  available: boolean;
  provider?: string;
  reason?: VoiceDisabledReason;
  message?: string;
}

export interface OutboundCallRequest {
  localCallId: string;
  to: string;
  from?: string;
  contactId?: number | null;
  contactPointId?: number | null;
}

export interface StartCallResult {
  providerCallId: string | null;
  status: CallStatus;
  raw?: Record<string, unknown>;
}

export type CallResult = StartCallResult;

export interface EndCallResult {
  providerCallId: string;
  status: CallStatus;
  raw?: Record<string, unknown>;
}

export interface InboundCallEvent {
  providerCallId: string | null;
  direction: "inbound";
  from: string;
  to: string;
  status: CallStatus;
  occurredAt?: string;
  raw?: Record<string, unknown>;
}

export interface CallStatusUpdate {
  providerCallId: string;
  status: CallStatus;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  redactedError?: string;
  raw?: Record<string, unknown>;
}

export interface CallRecordInput {
  localCallId: string;
  providerKind: "voice_edge";
  providerName: string;
  providerCallId?: string | null;
  direction: CallDirection;
  from?: string | null;
  to: string;
  contactId?: number | null;
  contactPointId?: number | null;
  status: CallStatus;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  redactedError?: string;
}

// Every channel adapter implements capability discovery, credential validation,
// and send. Voice control and webhook normalization are optional and present
// only on adapters whose capabilities advertise them.
export interface ChannelAdapter {
  capabilities(): ChannelCapabilities;
  supports(capability: Capability): boolean;
  validateCredentials(): Promise<CredentialValidation>;
  send(message: OutboundMessage): Promise<SendResult>;
  voiceAvailability?(): Promise<VoiceAvailability>;
  startCall?(request: OutboundCallRequest): Promise<StartCallResult>;
  endCall?(providerCallId: string): Promise<EndCallResult>;
  // Inbound/status payloads differ per provider (form-encoded for Twilio, JSON for
  // Telnyx), so the raw payload is passed as unknown and each adapter interprets it.
  parseInbound?(payload: unknown): InboundMessage;
  parseStatus?(payload: unknown): DeliveryStatusUpdate;
  parseInboundCall?(payload: unknown): InboundCallEvent;
  parseCallStatus?(payload: unknown): CallStatusUpdate;
}

// Providers that are designed but not yet shipped as adapters (CLV-008). Surfaced
// so the UI can show the roadmap without registering broken adapters.
export interface PlannedChannel {
  kind: ChannelKind;
  provider: string;
  displayName: string;
  status: "planned";
}

export const PLANNED_PROVIDERS: PlannedChannel[] = [
  { kind: "sms_mms_edge", provider: "plivo", displayName: "Plivo", status: "planned" },
  { kind: "sms_mms_edge", provider: "bandwidth", displayName: "Bandwidth", status: "planned" }
];

export class UnsupportedCapabilityError extends Error {
  constructor(public readonly capability: Capability, public readonly provider?: string) {
    super(provider
      ? `Provider '${provider}' does not support capability '${capability}'.`
      : `No configured provider supports capability '${capability}'.`);
    this.name = "UnsupportedCapabilityError";
  }
}

export interface ChannelRegistry {
  register(adapter: ChannelAdapter): void;
  get(provider: string): ChannelAdapter | undefined;
  list(): ChannelCapabilities[];
  select(capability: Capability, provider?: string): ChannelAdapter;
}

export function createChannelRegistry(): ChannelRegistry {
  const adapters = new Map<string, ChannelAdapter>();
  return {
    register(adapter) {
      adapters.set(adapter.capabilities().provider, adapter);
    },
    get(provider) {
      return adapters.get(provider);
    },
    list() {
      return [...adapters.values()].map((adapter) => adapter.capabilities());
    },
    select(capability, provider) {
      const pool = provider
        ? (adapters.has(provider) ? [adapters.get(provider) as ChannelAdapter] : [])
        : [...adapters.values()];
      const match = pool.find((adapter) => adapter.supports(capability));
      if (!match) throw new UnsupportedCapabilityError(capability, provider);
      return match;
    }
  };
}

// Convenience for adapters: capability membership from a capabilities list.
export function hasCapability(capabilities: ChannelCapabilities, capability: Capability): boolean {
  return capabilities.capabilities.includes(capability);
}
