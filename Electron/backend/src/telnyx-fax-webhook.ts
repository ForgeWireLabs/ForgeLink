// Telnyx Programmable Fax webhook ingress: signature-independent parsing,
// event normalization, and durable-record processing (work item 041, Phase
// 3: FAX-006). Signature/timestamp verification stays in server.ts using the
// existing hardened `verifyTelnyxWebhook` primitive (genuinely the same
// Ed25519-over-`${timestamp}|${rawBody}` contract as SMS/MMS); everything
// fax-lifecycle-specific -- event allow-list, state mapping, failure-reason
// redaction, client_state correlation -- lives here, kept fully separate
// from telnyx.ts's SMS/MMS webhook parsing. The frozen contract this module
// implements is recorded in
// work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase3-telnyx-fax-webhook-contract.md.

import { FaxDirection, FaxState } from "./fax";
import { PhoneDatabase, TelnyxFaxWebhookEventRow } from "./database";

// --- Event allow-list and state mapping (frozen contract) -------------------
// Keyed by Telnyx's `data.event_type`, not `data.payload.status` -- event_type
// is the reliable discriminator Telnyx's webhook docs guarantee for both
// families. An event_type not in this map is authentic-but-unsupported and
// must be durably classified as such, never guessed into lifecycle state.
const TELNYX_FAX_EVENT_STATE_MAP: Readonly<Record<string, FaxState>> = {
  "fax.queued": "accepted",
  "fax.media.processed": "accepted",
  "fax.sending.started": "sending",
  "fax.delivered": "delivered",
  "fax.failed": "failed",
  "fax.receiving.started": "receiving",
  "fax.media.processing.started": "processing",
  "fax.received": "received"
};

const TELNYX_FAX_INBOUND_EVENT_TYPES: ReadonlySet<string> = new Set([
  "fax.receiving.started",
  "fax.media.processing.started",
  "fax.received"
]);

// --- Event-type/direction compatibility (Phase 3.1, FAX-006 correction) ----
// Phase 3's original routing branched only on `isTelnyxFaxInboundEventType`,
// which never included `fax.failed` -- so an authentic inbound fax.failed
// event fell through into outbound local-fax resolution instead of the
// deferred_inbound path the frozen contract already documented (fax.failed
// is valid for both directions). Direction compatibility is now explicit
// and keyed off the validated envelope/ingress-row `direction`, never
// inferred from event_type alone:
//   outbound-only : fax.queued, fax.media.processed, fax.sending.started, fax.delivered
//   inbound-only  : fax.receiving.started, fax.media.processing.started, fax.received
//   shared        : fax.failed
// An event whose type's scope disagrees with the row's own validated
// direction (e.g. an outbound-only event type claiming inbound direction)
// is never guessed into either lifecycle -- it fails closed as a bounded
// event/direction mismatch.
export type TelnyxFaxEventDirectionScope = "outbound" | "inbound" | "shared";

const TELNYX_FAX_OUTBOUND_ONLY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "fax.queued",
  "fax.media.processed",
  "fax.sending.started",
  "fax.delivered"
]);

const TELNYX_FAX_SHARED_EVENT_TYPES: ReadonlySet<string> = new Set(["fax.failed"]);

export function telnyxFaxEventDirectionScope(eventType: string): TelnyxFaxEventDirectionScope | null {
  if (TELNYX_FAX_OUTBOUND_ONLY_EVENT_TYPES.has(eventType)) return "outbound";
  if (TELNYX_FAX_INBOUND_EVENT_TYPES.has(eventType)) return "inbound";
  if (TELNYX_FAX_SHARED_EVENT_TYPES.has(eventType)) return "shared";
  return null;
}

// True only when this event type's scope is "shared" or matches `direction`
// exactly. An unsupported event type (scope null) is never compatible here
// -- callers must check isTelnyxFaxSupportedEventType first.
export function isTelnyxFaxEventDirectionCompatible(eventType: string, direction: FaxDirection): boolean {
  const scope = telnyxFaxEventDirectionScope(eventType);
  return scope === "shared" || scope === direction;
}

export function mapTelnyxFaxEventType(eventType: string): FaxState | null {
  return TELNYX_FAX_EVENT_STATE_MAP[eventType] ?? null;
}

export function isTelnyxFaxSupportedEventType(eventType: string): boolean {
  return eventType in TELNYX_FAX_EVENT_STATE_MAP;
}

// Inbound-only event types (excludes the shared fax.failed). Kept as a
// narrower predicate for callers that specifically need "does this event
// type only ever belong to inbound reception" -- routing decisions should
// use isTelnyxFaxEventDirectionCompatible instead, since fax.failed is
// legitimately routable to either lifecycle depending on the validated
// direction.
export function isTelnyxFaxInboundEventType(eventType: string): boolean {
  return TELNYX_FAX_INBOUND_EVENT_TYPES.has(eventType);
}

// Telnyx documents the inbound fax.received `media_url` as a signed link
// valid for roughly 10 minutes (developers.telnyx.com/docs/programmable-fax/
// receive-a-fax-api, verified 2026-09-10 -- see the Phase 3 contract). Used
// to compute a conservative expiry for the transient ingress-row copy of
// that URL; Phase 3.x never downloads it. If Telnyx's documented validity
// window changes, update this constant and its citation together -- never
// silently widen it without re-verifying against current documentation.
export const TELNYX_FAX_TRANSIENT_MEDIA_URL_VALIDITY_MS = 10 * 60 * 1000;

// Customer-facing failure_reason allow-list (frozen contract, from the
// authoritative Telnyx OpenAPI spec's Fax.failure_reason description).
// `internal_failure_reason` is never read anywhere in this module. Any
// value outside this allow-list -- including a genuinely new future Telnyx
// category -- becomes the generic "unknown" category rather than being
// copied verbatim (never treat arbitrary provider text as safe).
const TELNYX_FAX_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "receiver_call_dropped", "sender_call_dropped", "sender_canceled", "carrier_lost",
  "service_unavailable", "fax_signaling_error", "receiver_communication_error",
  "sender_communication_error", "receiver_decline", "receiver_recovery_on_timer_expire",
  "receiver_no_response", "receiver_invalid_number_format", "receiver_no_answer",
  "receiver_incompatible_destination", "receiver_unallocated_number", "destination_unreachable",
  "user_busy", "invalid_ecm_response_from_receiver", "fax_initial_communication_timeout",
  "destination_not_in_service_plan", "account_disabled", "destination_invalid",
  "no_outbound_profile", "destination_not_in_countries_whitelist", "user_channel_limit_exceeded",
  "outbound_profile_channel_limit_exceeded", "connection_channel_limit_exceeded",
  "outbound_profile_daily_spend_limit_exceeded", "unverified_origination_number",
  "unverified_destination_not_allowed", "file_format_invalid", "file_download_failed",
  "file_size_limit_exceeded", "page_count_limit_exceeded", "media_processing_exception"
]);

export function safeTelnyxFaxFailureCategory(failureReason: unknown): string {
  const value = typeof failureReason === "string" ? failureReason.trim().slice(0, 80) : "";
  if (!value) return "";
  return TELNYX_FAX_FAILURE_REASONS.has(value) ? value : "unknown";
}

// --- Webhook envelope parsing (bounded, bad-JSON-safe) ----------------------

export interface TelnyxFaxWebhookEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  providerFaxId: string;
  // Absent/invalid direction is preserved as `null`, never defaulted --
  // callers must refuse to mutate state on a null direction (Phase 2.1's
  // "never default to outbound" rule applies equally to webhooks).
  direction: FaxDirection | null;
  clientState: string;
  pageCount: number | null;
  failureCategory: string;
  transientMediaUrl: string;
  // Bounded expiry for transientMediaUrl, derived from occurredAt plus
  // TELNYX_FAX_TRANSIENT_MEDIA_URL_VALIDITY_MS. '' when there is no media
  // URL (never a fabricated expiry for a URL that was never present).
  transientMediaExpiresAt: string;
  attempt: number;
  deliveredTo: string;
}

interface TelnyxFaxWebhookBody {
  data?: {
    id?: string;
    event_type?: string;
    occurred_at?: string;
    payload?: {
      fax_id?: string;
      id?: string;
      direction?: string;
      client_state?: string;
      page_count?: number | string;
      failure_reason?: string;
      media_url?: string;
    };
  };
  meta?: { attempt?: number | string; delivered_to?: string };
}

export function parseTelnyxFaxWebhookEnvelope(event: unknown): TelnyxFaxWebhookEnvelope | null {
  const value = event as TelnyxFaxWebhookBody;
  const eventId = typeof value?.data?.id === "string" ? value.data.id.trim() : "";
  const eventType = typeof value?.data?.event_type === "string" ? value.data.event_type.trim() : "";
  const occurredAtRaw = typeof value?.data?.occurred_at === "string" ? value.data.occurred_at.trim() : "";
  if (!eventId || eventId.length > 120 || !eventType || eventType.length > 80 || !occurredAtRaw || !Number.isFinite(Date.parse(occurredAtRaw))) return null;

  const payload = value.data?.payload ?? {};
  const providerFaxIdRaw = typeof payload.fax_id === "string" ? payload.fax_id : typeof payload.id === "string" ? payload.id : "";
  const providerFaxId = providerFaxIdRaw.trim().slice(0, 120);
  if (!providerFaxId) return null;

  const rawDirection = payload.direction;
  const direction: FaxDirection | null = rawDirection === "outbound" ? "outbound" : rawDirection === "inbound" ? "inbound" : null;

  const clientState = typeof payload.client_state === "string" ? payload.client_state.slice(0, 512) : "";

  const rawPageCount = Number(payload.page_count);
  const pageCount = Number.isInteger(rawPageCount) && rawPageCount >= 0 && rawPageCount <= 100_000 ? rawPageCount : null;

  const failureCategory = safeTelnyxFaxFailureCategory(payload.failure_reason);

  // Transient only: never becomes a durable FaxDocumentRef, held only in the
  // ingress row under the short-lived recovery policy for Phase 4.
  const transientMediaUrl = typeof payload.media_url === "string" ? payload.media_url.slice(0, 2048) : "";
  const occurredAt = new Date(occurredAtRaw).toISOString();
  // Conservative expiry: derived from the provider event's own occurred_at
  // (not received_at/now), so a delayed-delivery webhook does not appear
  // to grant more remaining validity than Telnyx actually intended. '' when
  // there is no media URL to expire in the first place.
  const transientMediaExpiresAt = transientMediaUrl
    ? new Date(new Date(occurredAt).getTime() + TELNYX_FAX_TRANSIENT_MEDIA_URL_VALIDITY_MS).toISOString()
    : "";

  const rawAttempt = Number(value.meta?.attempt || 0);
  const attempt = Number.isInteger(rawAttempt) && rawAttempt >= 0 && rawAttempt <= 100 ? rawAttempt : 0;
  const deliveredTo = typeof value.meta?.delivered_to === "string" ? value.meta.delivered_to.trim().slice(0, 2048) : "";

  return {
    eventId,
    eventType,
    occurredAt,
    providerFaxId,
    direction,
    clientState,
    pageCount,
    failureCategory,
    transientMediaUrl,
    transientMediaExpiresAt,
    attempt,
    deliveredTo
  };
}

// --- client_state correlation (untrusted provider input, strictly bounded) --
// Telnyx echoes back exactly what ForgeLink sent as base64 `client_state`
// (JSON-mode sends only -- see the frozen contract's multipart limitation).
// Even though the webhook envelope itself is signed, `client_state` is
// still treated as untrusted content: it must look like canonical base64,
// decode to ForgeLink's own opaque correlation-token shape
// (generateProviderCorrelationToken's output), and nothing else is ever
// accepted or logged.
const CANONICAL_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const CORRELATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function decodeTelnyxClientStateCorrelationToken(clientStateBase64: string): string | null {
  const value = String(clientStateBase64 || "");
  if (!value || value.length > 512 || value.length % 4 !== 0 || !CANONICAL_BASE64_PATTERN.test(value)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
  return CORRELATION_TOKEN_PATTERN.test(decoded) ? decoded : null;
}

// --- Local fax resolution and event processing ------------------------------

export type FaxWebhookDatabase = Pick<
  PhoneDatabase,
  | "faxByLocalId"
  | "faxByProviderFaxId"
  | "faxByProviderCorrelationToken"
  | "bindFaxProvider"
  | "bindFaxProviderIdentity"
  | "recordFaxEvent"
  | "completeTelnyxFaxWebhookEvent"
>;

// Resolution order (frozen contract): (1) direct (provider, provider_fax_id)
// lookup; (2) if unresolved and a valid client_state correlation token
// exists, resolve by token and bind the provider fax id now that it is
// known; (3) otherwise the event stays unresolved. Never heuristic-matches
// on recipient/sender/timestamp/page-count/filename/document hash.
function resolveTelnyxFaxLocalId(provider: string, envelope: { providerFaxId: string; clientState: string }, database: FaxWebhookDatabase): string | null {
  const direct = database.faxByProviderFaxId(provider, envelope.providerFaxId);
  if (direct) return direct.local_fax_id;

  if (envelope.clientState) {
    const token = decodeTelnyxClientStateCorrelationToken(envelope.clientState);
    if (token) {
      const byToken = database.faxByProviderCorrelationToken(token);
      if (byToken && (byToken.provider === "" || byToken.provider === provider)) {
        const providerBinding = database.bindFaxProvider(byToken.local_fax_id, provider);
        if (providerBinding === "bound" || providerBinding === "already_bound") {
          const identityBinding = database.bindFaxProviderIdentity(byToken.local_fax_id, provider, envelope.providerFaxId);
          if (identityBinding === "bound" || identityBinding === "already_bound") return byToken.local_fax_id;
        }
      }
    }
  }
  return null;
}

// Processes exactly one durably-enqueued ingress row. Fully synchronous
// (SQL calls only) so this can be called both from the sequential drain
// loop and, inline, immediately after a provider fax id is bound
// (FaxSubmissionService's `onProviderFaxIdBound` hook) -- no scheduling
// coordination is needed to make the "webhook arrived before the POST
// response" race converge without a restart.
export function processTelnyxFaxWebhookEvent(row: TelnyxFaxWebhookEventRow, database: FaxWebhookDatabase, provider = "telnyx"): void {
  try {
    if (!isTelnyxFaxSupportedEventType(row.event_type)) {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "unsupported");
      return;
    }
    if (row.direction !== "outbound" && row.direction !== "inbound") {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "invalid_direction");
      return;
    }
    // Phase 3.1 correction: route on the event type's actual
    // outbound/inbound/shared scope compared against the row's own
    // validated direction -- never on event_type alone. An outbound-only
    // event type claiming inbound direction (or vice versa) is an
    // authentic-but-incoherent event and fails closed without entering
    // either lifecycle; it is never guessed into one.
    if (!isTelnyxFaxEventDirectionCompatible(row.event_type, row.direction)) {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "event_direction_mismatch");
      return;
    }

    const scope = telnyxFaxEventDirectionScope(row.event_type);
    // An inbound-only event type is always inbound processing; a shared
    // event type (fax.failed) is inbound processing only when the row's
    // own validated direction says so -- this is what previously let an
    // inbound fax.failed event fall through into outbound local-fax
    // resolution.
    const isInboundProcessing = scope === "inbound" || (scope === "shared" && row.direction === "inbound");
    if (isInboundProcessing) {
      // Phase 3 boundary: authenticate and durably queue only. Inbound fax
      // state creation/reconciliation and document acquisition are Phase 4.
      // This must never be mistaken for a processing failure on restart,
      // and must never attempt any local outbound fax lookup/mutation.
      database.completeTelnyxFaxWebhookEvent(row.event_id, "deferred_inbound");
      return;
    }

    const localFaxId = resolveTelnyxFaxLocalId(provider, { providerFaxId: row.provider_fax_id, clientState: row.client_state }, database);
    if (!localFaxId) {
      // A valid outbound webhook may legitimately arrive before the POST
      // response has bound the provider fax id. Stay durably eligible for
      // reprocessing -- never mark this processed-and-lost, and never spin:
      // this status is excluded from the immediate "keep draining" trigger.
      database.completeTelnyxFaxWebhookEvent(row.event_id, "unresolved");
      return;
    }

    const localFax = database.faxByLocalId(localFaxId);
    if (!localFax || localFax.direction !== row.direction) {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", localFaxId, "direction_mismatch");
      return;
    }

    const normalizedState = mapTelnyxFaxEventType(row.event_type);
    if (!normalizedState) {
      // Defensive; isTelnyxFaxSupportedEventType already guarantees this.
      database.completeTelnyxFaxWebhookEvent(row.event_id, "unsupported");
      return;
    }

    database.recordFaxEvent({
      provider,
      event_id: row.event_id,
      fax_id: localFaxId,
      provider_fax_id: row.provider_fax_id,
      event_type: row.event_type,
      normalized_state: normalizedState,
      occurred_at: row.occurred_at,
      payload_sha256: row.payload_sha256,
      // Phase 3.1 correction: previously dropped at this exact handoff --
      // failure_category is already bounded/allow-listed by the parser
      // (safeTelnyxFaxFailureCategory), and page_count is already bounded
      // by the parser too. internal_failure_reason is never read anywhere
      // upstream of this call.
      failure_category: row.failure_category,
      page_count: row.page_count
    });
    database.completeTelnyxFaxWebhookEvent(row.event_id, "resolved", localFaxId);
  } catch {
    database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "processing_failed");
  }
}
