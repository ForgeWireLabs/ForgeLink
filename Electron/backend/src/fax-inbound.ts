// Inbound fax reception: local identity, Fax Application ownership
// validation, and provider-observation application for authenticated
// `deferred_inbound` Telnyx Fax webhook events (work item 041, Phase 4:
// FAX-007).
//
// This module is deliberately DB-only -- no network call, no document
// download. It turns a durably-enqueued, signature-verified ingress row
// into (a) a durable local inbound fax record and (b) a claimed document
// acquisition row when the event is `fax.received`. The actual bytes are
// fetched by fax-inbound-acquisition.ts, run as a separate, bounded,
// asynchronous worker -- never inline here, so the ordinary ingress drain
// (server.ts's scheduleTelnyxFaxWebhookDrain, which only ever touches
// `pending` rows) never performs a network download merely by consuming
// this module's output, and this module's own sweep of `deferred_inbound`
// rows never blocks on one either.
//
// Transport state (FaxState: receiving/processing/received/failed) and
// document acquisition state (FaxDocumentAcquisitionState: pending/
// acquiring/available/retryable/quarantined/unavailable/not_required) are
// deliberately separate authorities -- see database.ts's
// FaxDocumentAcquisitionState comment. A received fax whose PDF could not
// be safely downloaded/validated is never retroactively reported as a
// failed transmission, and a successfully acquired document never
// fabricates a transport observation the provider did not report.

import { PhoneDatabase, TelnyxFaxWebhookEventRow } from "./database";
import { isTelnyxFaxEventDirectionCompatible, mapTelnyxFaxEventType, telnyxFaxEventDirectionScope } from "./telnyx-fax-webhook";

export type InboundFaxProcessingDatabase = Pick<
  PhoneDatabase,
  | "ensureInboundFax"
  | "applyFaxObservation"
  | "recordFaxEvent"
  | "completeTelnyxFaxWebhookEvent"
  | "claimInboundFaxAcquisition"
  | "setFaxDocumentAcquisitionState"
>;

export interface InboundFaxIngressConfig {
  // The configured Telnyx Fax Application (connection) id ForgeLink owns.
  // Telnyx webhook signatures are account-level trust, not proof an event
  // belongs to this specific Fax Application -- see "Fax Application
  // ownership validation" in the Phase 4 contract. Blank means inbound
  // reception is not configured; every event fails closed as
  // foreign_connection rather than silently accepting an unbound event.
  connectionId: string;
}

// Processes exactly one durably-enqueued `deferred_inbound` ingress row.
// Fully synchronous (SQL calls only), matching processTelnyxFaxWebhookEvent's
// own design, so the caller can run this from a bounded sweep loop with no
// scheduling coordination required.
export function processDeferredInboundFaxEvent(
  row: TelnyxFaxWebhookEventRow,
  database: InboundFaxProcessingDatabase,
  config: InboundFaxIngressConfig,
  provider = "telnyx"
): void {
  try {
    // Fax Application ownership boundary: an authentic Telnyx event may
    // legitimately belong to a different Fax Application within the same
    // Telnyx account. Never create/mutate a local fax for an event outside
    // the configured boundary -- and never log the full from/to/media_url
    // for this disposition (bounded_error stays a fixed category string).
    if (!config.connectionId || row.connection_id !== config.connectionId) {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "foreign_connection");
      return;
    }
    if (row.direction !== "inbound") {
      // Should be unreachable given Phase 3.1's event/direction gate
      // (isTelnyxFaxEventDirectionCompatible already ran before this row
      // could become deferred_inbound), but this module never assumes
      // upstream correctness on its own.
      database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "invalid_direction");
      return;
    }
    if (!isTelnyxFaxEventDirectionCompatible(row.event_type, "inbound") || telnyxFaxEventDirectionScope(row.event_type) === "outbound") {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "event_direction_mismatch");
      return;
    }
    const normalizedState = mapTelnyxFaxEventType(row.event_type);
    if (!normalizedState) {
      database.completeTelnyxFaxWebhookEvent(row.event_id, "unsupported");
      return;
    }

    const localFaxId = database.ensureInboundFax({
      provider,
      providerFaxId: row.provider_fax_id,
      fromNumber: row.from_number,
      toNumber: row.to_number
    });
    if (!localFaxId) {
      // A genuine identity conflict (e.g. this provider_fax_id is already
      // bound to an outbound fax) -- fail closed, never guess which
      // record is correct.
      database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "inbound_identity_conflict");
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
      failure_category: row.failure_category,
      page_count: row.page_count
    });

    if (row.event_type === "fax.received") {
      // Claim/create the acquisition authority exactly once per
      // (provider, provider_fax_id) -- idempotent even if this exact
      // event, or a duplicate fax.received webhook, is processed more
      // than once; see claimInboundFaxAcquisition's own contract.
      database.claimInboundFaxAcquisition({
        provider,
        providerFaxId: row.provider_fax_id,
        localFaxId,
        sourceEventId: row.event_id,
        transientMediaUrl: row.transient_media_url,
        transientMediaExpiresAt: row.transient_media_expires_at
      });
    } else if (normalizedState === "failed") {
      // No document to acquire for a failed inbound transmission -- never
      // attempt a download for one.
      database.setFaxDocumentAcquisitionState(localFaxId, "not_required");
    }

    database.completeTelnyxFaxWebhookEvent(row.event_id, "inbound_applied", localFaxId);
  } catch {
    database.completeTelnyxFaxWebhookEvent(row.event_id, "failed", undefined, "processing_failed");
  }
}
