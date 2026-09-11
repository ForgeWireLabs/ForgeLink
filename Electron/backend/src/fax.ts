// Provider-neutral fax domain contracts and lifecycle state machine
// (work item 041, Phase 1: FAX-002, FAX-003; Phase 1.1 hardening correction).
//
// Fax is a document-transmission domain, not a widened SMS message: pages,
// quality, cover metadata, a multi-stage asynchronous transmission, and
// long-lived receive/delivery evidence do not fit channels.ts's
// OutboundMessage ({ to, body, mediaUrls }). This module defines the
// provider-neutral fax wire contracts -- mirroring channels.ts's role for
// SMS/MMS/voice -- and the sealed local lifecycle state machine. No
// Telnyx-specific type or value lives here (FAX-INV-4/FAX-INV-5); the Telnyx
// adapter lands in Phase 2.
//
// Phase 1.1 separates two distinct kinds of state change, reviewed and found
// conflated in Phase 1:
//
//   - a LOCAL COMMAND transition (operator/system driven: draft -> prepared,
//     the atomic submission claim, a cancel request) is strict and
//     adjacency-based -- see classifyFaxCommandTransition.
//   - a PROVIDER OBSERVATION (a normalized webhook/status event) must
//     converge correctly even when delivered out of order, duplicated, or
//     missing intermediate stages -- see reconcileFaxObservation, which
//     allows forward skip-ahead (via graph reachability) but never
//     regression, and is itself direction-scoped so an inbound observation
//     can never move an outbound record and vice versa.

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

// Direction-scoped legal-transition graphs. Splitting the graph by direction
// (rather than relying on the two subgraphs happening not to intersect) is a
// deliberate Phase 1.1 correction: it makes cross-direction contamination a
// lookup miss instead of an accident of which edges someone remembered to add.
//
//   outbound: draft -> prepared -> submission_pending -> submitting -> accepted -> sending -> delivered
//                                                            |             |          |
//                                                            v             v          v
//                                                        ambiguous      failed   cancel_pending -> cancelled
//                                                            |
//                                                  (reconciliation) -> accepted | failed | cancelled
//
//   inbound: receiving -> processing -> received
//                 \-> failed              \-> failed
const FAX_LEGAL_TRANSITIONS_OUTBOUND: Readonly<Partial<Record<FaxState, readonly FaxState[]>>> = {
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
  failed: []
};

const FAX_LEGAL_TRANSITIONS_INBOUND: Readonly<Partial<Record<FaxState, readonly FaxState[]>>> = {
  receiving: ["processing", "failed"],
  processing: ["received", "failed"],
  received: [],
  failed: []
};

const FAX_LEGAL_TRANSITIONS_BY_DIRECTION: Readonly<Record<FaxDirection, Readonly<Partial<Record<FaxState, readonly FaxState[]>>>>> = {
  outbound: FAX_LEGAL_TRANSITIONS_OUTBOUND,
  inbound: FAX_LEGAL_TRANSITIONS_INBOUND
};

// The initial state a fax is created in is a function of direction, not a
// single hardcoded value. Phase 1 hardcoded "draft" for every direction,
// which put an inbound fax in an outbound-only state it could never legally
// leave (draft -> receiving is not, and must not become, a legal edge).
export const FAX_INITIAL_STATE: Readonly<Record<FaxDirection, FaxState>> = {
  outbound: "draft",
  inbound: "receiving"
};

// True only if `state` is a member of `direction`'s own state graph. Used to
// reject cross-direction states outright (an inbound record must never even
// be *checked* against outbound edges, and vice versa).
export function faxStateBelongsToDirection(direction: FaxDirection, state: FaxState): boolean {
  return state in FAX_LEGAL_TRANSITIONS_BY_DIRECTION[direction];
}

export type FaxTransitionOutcome = "applied" | "duplicate" | "illegal";

// Strict, adjacency-based LOCAL COMMAND transition. Used for operator/system
// driven moves: draft -> prepared, the atomic submission claim
// (submission_pending -> submitting), and a cancel request. Direction-scoped:
// an edge that only exists in the other direction's graph is illegal here,
// not merely "not found". `duplicate` means the target equals the current
// state (an idempotent no-op, e.g. a retried "begin submission" call);
// `illegal` means the edge is a regression, a skip-ahead, or belongs to the
// wrong direction, and must be rejected without mutating anything.
export function classifyFaxCommandTransition(direction: FaxDirection, current: FaxState, next: FaxState): FaxTransitionOutcome {
  if (!faxStateBelongsToDirection(direction, current) || !faxStateBelongsToDirection(direction, next)) return "illegal";
  if (current === next) return "duplicate";
  const legal = FAX_LEGAL_TRANSITIONS_BY_DIRECTION[direction][current];
  return legal?.includes(next) ? "applied" : "illegal";
}

// Precomputed transitive closure of each direction's legal-transition graph:
// REACHABLE_FROM[direction][state] is every state reachable from `state` by
// zero or more legal command edges within that direction. Computed once at
// module load (the graphs are static and tiny).
type ReachabilityMap = Partial<Record<FaxState, ReadonlySet<FaxState>>>;

function computeReachability(graph: Readonly<Partial<Record<FaxState, readonly FaxState[]>>>): ReachabilityMap {
  const result: ReachabilityMap = {};
  for (const start of Object.keys(graph) as FaxState[]) {
    const visited = new Set<FaxState>();
    const stack: FaxState[] = [start];
    while (stack.length) {
      const node = stack.pop()!;
      for (const next of graph[node] || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    result[start] = visited;
  }
  return result;
}

const FAX_REACHABLE_FROM: Readonly<Record<FaxDirection, ReachabilityMap>> = {
  outbound: computeReachability(FAX_LEGAL_TRANSITIONS_OUTBOUND),
  inbound: computeReachability(FAX_LEGAL_TRANSITIONS_INBOUND)
};

export type FaxObservationOutcome = "advanced" | "duplicate" | "stale" | "illegal";

// Monotonic, direction-aware, skip-ahead-safe reconciliation for a PROVIDER
// OBSERVATION (a normalized webhook/status event), as opposed to a local
// command. Telnyx (and providers generally) may deliver fax lifecycle events
// out of order, near-simultaneously, or duplicated -- classifyFaxCommandTransition's
// strict single-edge check is deliberately too strict for this: an
// "accepted" fax observing "delivered" directly (having missed the
// intermediate "sending" webhook) must still converge to "delivered", not be
// rejected as illegal.
//
// The rule: `observed` is accepted ("advanced") only if it is reachable from
// `current` via zero or more legal command edges in `current`'s own
// direction -- i.e. it is somewhere ForgeLink's own state machine agrees the
// fax could legitimately still end up. This still refuses genuine regression
// (a "sending" fax cannot un-observe back to "accepted") and refuses
// cross-direction contamination (an inbound observation can never move an
// outbound record), while allowing forward convergence without requiring
// every missing intermediate webhook -- including from "ambiguous", which by
// definition has no better information than "some later authoritative
// outcome occurred".
//
// `duplicate`: observed === current (already there; recorded for evidence,
// not reapplied). `stale`: observed is a real state in this direction but not
// reachable from current (a late, superseded observation -- state must not
// regress). `illegal`: observed does not belong to this direction's graph at
// all (a genuine cross-direction/invalid observation).
export function reconcileFaxObservation(direction: FaxDirection, current: FaxState, observed: FaxState): FaxObservationOutcome {
  if (!faxStateBelongsToDirection(direction, current) || !faxStateBelongsToDirection(direction, observed)) return "illegal";
  if (current === observed) return "duplicate";
  return FAX_REACHABLE_FROM[direction][current]?.has(observed) ? "advanced" : "stale";
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

// Provider-neutral outbound fax request. `correlation` is the one safe,
// generic cross-system correlation concept (README: "safe correlation/
// idempotency data"). Phase 1.1 removed a `clientState` field that leaked
// Telnyx's `client_state` transport parameter (a base64-encoded, provider-side
// facility) into this neutral contract -- FAX-INV-4 violation found in
// review. When the Telnyx adapter lands (Phase 2), it may derive an
// appropriate `client_state` value from `correlation`/`localFaxId` itself;
// that mapping belongs inside the adapter, not here. `quality` stays a plain
// string on purpose -- provider-specific quality enums (e.g. Telnyx's normal/
// high/very_high/ultra_light/ultra_dark) belong in the Telnyx adapter/
// configuration layer, not as a neutral-domain union type.
export interface FaxRequest {
  localFaxId: string;
  from?: string;
  to: string;
  documentRef: FaxDocumentRef;
  coverDocumentRef?: FaxDocumentRef;
  quality?: string;
  correlation?: string;
}

export interface FaxResult {
  providerFaxId: string | null;
  normalizedState: FaxState;
  providerAcceptedAt?: string;
  safeProviderCode?: string;
}

// Phase 1.1 removed the `terminal` field found in review: terminality is
// fully derivable from `normalizedState` via isFaxTerminalState, and keeping
// a second, independently-settable field allowed a provider adapter to
// assert a contradictory pair such as { normalizedState: "sending", terminal:
// true }. ForgeLink's normalized lifecycle -- not a provider adapter --
// remains the sole authority on what counts as terminal.
// `direction` is an explicit, required observation property (Phase 2.1
// correction): a provider status string alone is not a safe direction proxy
// (e.g. "failed" is legal in both the outbound and inbound graphs), so
// callers reconciling this update must be able to verify the provider's
// observed direction against the local fax's own direction before ever
// calling applyFaxObservation. A missing/malformed provider direction must
// never be defaulted to "outbound" -- see FaxDirection callers.
export interface FaxStatusUpdate {
  providerFaxId: string;
  direction: FaxDirection;
  normalizedState: FaxState;
  occurredAt: string;
  safeProviderCode?: string;
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

// Provider-neutral outbound error taxonomy (work item 041, Phase 2). Sending
// a fax is a high-consequence external side effect, so a FaxProvider must be
// able to tell its caller (FaxSubmissionService) which of three distinct
// things happened, rather than just "it threw":
//
//   - FaxProviderPreflightError: the provider was never called at all (bad
//     local configuration, an unresolvable document, etc). Safe to treat as a
//     definite local failure -- no external side effect could have occurred.
//   - FaxProviderRejectionError: the provider was called and explicitly,
//     definitively rejected the request (a documented 4xx-style response).
//     Safe to treat as a definite failure.
//   - FaxProviderAmbiguousError: the provider was called but ForgeLink cannot
//     prove whether it accepted the request (timeout, connection reset after
//     write, a 5xx where acceptance cannot be excluded, a malformed
//     "successful" response, an unexpected/unrecognized response). This is
//     never safe to automatically retry -- see FAX-INV-6/FAX-INV-7 and
//     FaxState "ambiguous".
//
// `category` is a short, bounded, safe label (never a raw provider response
// body, error detail string, or anything that could carry document/media
// information) suitable for display and for the durable `failure_category`
// column.
export class FaxProviderPreflightError extends Error {
  constructor(public readonly category: string, message: string) {
    super(message);
    this.name = "FaxProviderPreflightError";
  }
}

export class FaxProviderRejectionError extends Error {
  constructor(public readonly category: string, message: string) {
    super(message);
    this.name = "FaxProviderRejectionError";
  }
}

export class FaxProviderAmbiguousError extends Error {
  constructor(public readonly category: string, message: string) {
    super(message);
    this.name = "FaxProviderAmbiguousError";
  }
}
