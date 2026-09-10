// Provider-neutral fax domain contracts and lifecycle state machine
// (work item 041, Phase 1: FAX-002, FAX-003).
//
// Fax is a document-transmission domain, not a widened SMS message: pages,
// quality, cover metadata, a multi-stage asynchronous transmission, and
// long-lived receive/delivery evidence do not fit channels.ts's
// OutboundMessage ({ to, body, mediaUrls }). This module defines the
// provider-neutral fax wire contracts -- mirroring channels.ts's role for
// SMS/MMS/voice -- and the sealed local lifecycle state machine that later
// Telnyx webhook normalization (Phase 3) will drive by event time and state
// precedence, not webhook arrival order. No Telnyx-specific type or value
// lives here (FAX-INV-4/FAX-INV-5); the Telnyx adapter lands in Phase 2.

import { ChannelCapabilities, CredentialValidation } from "./channels";

export type FaxDirection = "outbound" | "inbound";

// Who originated the fax: an authenticated human operator action, an agent
// request (governed by the communication firewall in a later phase), or an
// application acting through the API/MCP boundary. Phase 1 only persists this
// as provenance metadata; firewall/draft wiring is FAX-010 (a later phase).
export type FaxProvenance = "operator" | "agent" | "application";

// Sealed local lifecycle. Deliberately distinct from CallStatus: a fax needs
// an explicit "ambiguous" state for when a network failure occurs after the
// provider may already have accepted the transmission, and a distinct cancel
// path, because blindly retrying an ambiguous or in-flight fax risks a real
// duplicate transmission in a way retrying an SMS send does not (README
// FAX-INV-6/FAX-INV-7 and the "Error and retry semantics" section).
export type FaxState =
  | "draft"
  | "prepared"
  | "submission_pending"
  | "submitting"
  | "ambiguous"
  | "accepted"
  | "sending"
  | "cancel_pending"
  | "delivered"
  | "cancelled"
  | "failed"
  | "receiving"
  | "processing"
  | "received";

export const FAX_TERMINAL_STATES: ReadonlySet<FaxState> = new Set(["delivered", "cancelled", "failed", "received"]);

export function isFaxTerminalState(state: FaxState): boolean {
  return FAX_TERMINAL_STATES.has(state);
}

// Legal next-states per current state. Terminal states have no legal outward
// transition -- once delivered/cancelled/failed/received, the record is done.
// A transition to the *same* state (a duplicate or replayed event) is always
// a no-op, not an error; see classifyFaxTransition below.
//
//   draft -> prepared -> submission_pending -> submitting -> accepted -> sending -> delivered
//                                                  |             |          |
//                                                  v             v          v
//                                              ambiguous      failed   cancel_pending -> cancelled
//                                                  |
//                                        (reconciliation, Phase 3) -> accepted | failed | cancelled
//
//   receiving -> processing -> received
//        \-> failed              \-> failed
const FAX_LEGAL_TRANSITIONS: Readonly<Record<FaxState, readonly FaxState[]>> = {
  draft: ["prepared"],
  prepared: ["submission_pending"],
  submission_pending: ["submitting", "failed"],
  submitting: ["accepted", "failed", "ambiguous"],
  ambiguous: ["accepted", "failed", "cancelled"],
  accepted: ["sending", "failed", "cancel_pending"],
  sending: ["delivered", "failed", "cancel_pending"],
  cancel_pending: ["cancelled", "delivered", "failed"],
  delivered: [],
  cancelled: [],
  failed: [],
  receiving: ["processing", "failed"],
  processing: ["received", "failed"],
  received: []
};

export type FaxTransitionOutcome = "applied" | "duplicate" | "illegal";

// Pure state-machine decision, independent of persistence and independent of
// event arrival order. `duplicate` means the event/request should be treated
// as an idempotent no-op (already in that state); `illegal` means the
// transition is a regression or otherwise not a legal edge from the current
// state and must be rejected without mutating anything. This lets later event
// normalization apply events by state precedence rather than trusting webhook
// delivery order (README: "out-of-order events do not blindly regress
// lifecycle state").
export function classifyFaxTransition(current: FaxState, next: FaxState): FaxTransitionOutcome {
  if (current === next) return "duplicate";
  if (FAX_LEGAL_TRANSITIONS[current]?.includes(next)) return "applied";
  return "illegal";
}

// --- Provider-neutral fax wire contracts (mirrors channels.ts for SMS/MMS/voice) ---

// Opaque local reference to a managed fax document (FAX-INV-8). Never a
// provider URL, never raw document bytes -- just enough to identify the
// artifact. The managed document record itself is `fax_documents` (database.ts).
export interface FaxDocumentRef {
  id: string;
  contentType?: string;
  pageCount?: number;
}

export interface FaxRequest {
  localFaxId: string;
  from?: string;
  to: string;
  documentRef: FaxDocumentRef;
  coverDocumentRef?: FaxDocumentRef;
  quality?: string;
  clientState?: string;
  correlation?: string;
}

export interface FaxResult {
  providerFaxId: string | null;
  normalizedState: FaxState;
  providerAcceptedAt?: string;
  safeProviderCode?: string;
}

export interface FaxStatusUpdate {
  providerFaxId: string;
  normalizedState: FaxState;
  occurredAt: string;
  safeProviderCode?: string;
  terminal: boolean;
}

export interface InboundFax {
  providerFaxId: string | null;
  from: string;
  to: string;
  occurredAt: string;
  pageCount?: number;
  remoteDocumentRef: string;
  providerMetadataSubset?: Record<string, string>;
}

// A fax provider is intentionally NOT a ChannelAdapter. Forcing every
// ChannelAdapter to implement fax methods (or a fax provider to implement
// send(OutboundMessage)) would contaminate both contracts -- the README is
// explicit that fax is a distinct document-transmission domain. A FaxProvider
// advertises capabilities() using the same ChannelCapabilities shape used
// elsewhere (so discovery/UI code stays uniform), but participates in its own
// registry rather than createChannelRegistry()/ChannelAdapter's `send`. No
// concrete provider implements this in Phase 1 -- the Telnyx Programmable Fax
// adapter is Phase 2.
export interface FaxProvider {
  capabilities(): ChannelCapabilities;
  validateCredentials(): Promise<CredentialValidation>;
  sendFax(request: FaxRequest): Promise<FaxResult>;
  cancelFax?(providerFaxId: string): Promise<FaxResult>;
  getFax?(providerFaxId: string): Promise<FaxStatusUpdate>;
  parseFaxEvent?(payload: unknown): FaxStatusUpdate | InboundFax;
  fetchInboundDocument?(reference: string): Promise<FaxDocumentRef>;
}
