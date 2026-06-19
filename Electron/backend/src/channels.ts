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

export interface CallResult {
  providerCallId: string | null;
  status: string;
}

// Every channel adapter implements capability discovery, credential validation,
// and send. Voice control and webhook normalization are optional and present
// only on adapters whose capabilities advertise them.
export interface ChannelAdapter {
  capabilities(): ChannelCapabilities;
  supports(capability: Capability): boolean;
  validateCredentials(): Promise<CredentialValidation>;
  send(message: OutboundMessage): Promise<SendResult>;
  startCall?(to: string): Promise<CallResult>;
  endCall?(providerCallId: string): Promise<void>;
  parseInbound?(fields: Record<string, string>): InboundMessage;
  parseStatus?(fields: Record<string, string>): DeliveryStatusUpdate;
}

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
