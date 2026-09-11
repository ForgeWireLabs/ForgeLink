// Telnyx Fax webhook ingress unit tests (work item 041, Phase 3: FAX-006).
// Signature/timestamp verification and the HTTP route itself are covered in
// server.test.ts; this file covers envelope parsing, event normalization,
// client_state correlation, local fax resolution, and durable-row processing
// in isolation, with no real network/provider call anywhere in this suite.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhoneDatabase, TelnyxFaxWebhookEventRow } from "./database";
import { generateProviderCorrelationToken } from "./fax-submission";
import {
  decodeTelnyxClientStateCorrelationToken,
  isTelnyxFaxInboundEventType,
  isTelnyxFaxSupportedEventType,
  mapTelnyxFaxEventType,
  parseTelnyxFaxWebhookEnvelope,
  processTelnyxFaxWebhookEvent,
  safeTelnyxFaxFailureCategory
} from "./telnyx-fax-webhook";

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "evt-1",
      event_type: "fax.queued",
      occurred_at: "2026-09-11T12:00:00.000Z",
      payload: { fax_id: "provider-fax-1", direction: "outbound", ...(overrides.payload as object || {}) }
    },
    meta: { attempt: 1, delivered_to: "https://forgelink.example/webhooks/telnyx/fax" },
    ...overrides
  };
}

// --- Event allow-list and normalization -------------------------------------

test("FAX-006: outbound event types normalize to the frozen state mapping", () => {
  assert.equal(mapTelnyxFaxEventType("fax.queued"), "accepted");
  assert.equal(mapTelnyxFaxEventType("fax.media.processed"), "accepted");
  assert.equal(mapTelnyxFaxEventType("fax.sending.started"), "sending");
  assert.equal(mapTelnyxFaxEventType("fax.delivered"), "delivered");
  assert.equal(mapTelnyxFaxEventType("fax.failed"), "failed");
  assert.equal(mapTelnyxFaxEventType("nonexistent.event"), null);
  assert.equal(isTelnyxFaxSupportedEventType("fax.queued"), true);
  assert.equal(isTelnyxFaxSupportedEventType("profile.updated"), false);
});

test("FAX-006: inbound event types are recognized as such but are never mapped for lifecycle mutation by this module alone", () => {
  for (const type of ["fax.receiving.started", "fax.media.processing.started", "fax.received"]) {
    assert.equal(isTelnyxFaxInboundEventType(type), true);
    assert.equal(isTelnyxFaxSupportedEventType(type), true);
  }
  assert.equal(isTelnyxFaxInboundEventType("fax.queued"), false);
});

test("FAX-006: failure_reason is mapped through the customer-safe allow-list; anything else becomes generic 'unknown'", () => {
  assert.equal(safeTelnyxFaxFailureCategory("user_busy"), "user_busy");
  assert.equal(safeTelnyxFaxFailureCategory("file_format_invalid"), "file_format_invalid");
  assert.equal(safeTelnyxFaxFailureCategory("some_brand_new_future_reason"), "unknown");
  assert.equal(safeTelnyxFaxFailureCategory(undefined), "");
  assert.equal(safeTelnyxFaxFailureCategory(123), "");
  // internal_failure_reason-shaped text must never pass through verbatim.
  assert.equal(safeTelnyxFaxFailureCategory("internal debug trace: stack overflow at frame 44"), "unknown");
});

// --- Envelope parsing --------------------------------------------------------

test("FAX-006: parses a well-formed outbound fax.queued envelope", () => {
  const envelope = parseTelnyxFaxWebhookEnvelope(baseEvent());
  assert.ok(envelope);
  assert.equal(envelope!.eventId, "evt-1");
  assert.equal(envelope!.eventType, "fax.queued");
  assert.equal(envelope!.providerFaxId, "provider-fax-1");
  assert.equal(envelope!.direction, "outbound");
  assert.equal(envelope!.attempt, 1);
  assert.equal(envelope!.deliveredTo, "https://forgelink.example/webhooks/telnyx/fax");
});

test("FAX-006: a missing/invalid direction is preserved as null, never defaulted to outbound", () => {
  const missing = parseTelnyxFaxWebhookEnvelope(baseEvent({ data: { id: "evt-2", event_type: "fax.queued", occurred_at: "2026-09-11T12:00:00.000Z", payload: { fax_id: "p-1" } } }));
  assert.equal(missing!.direction, null);
  const invalid = parseTelnyxFaxWebhookEnvelope(baseEvent({ data: { id: "evt-3", event_type: "fax.queued", occurred_at: "2026-09-11T12:00:00.000Z", payload: { fax_id: "p-1", direction: "sideways" } } }));
  assert.equal(invalid!.direction, null);
});

test("FAX-006: malformed/incomplete envelopes are rejected without throwing", () => {
  assert.equal(parseTelnyxFaxWebhookEnvelope(null), null);
  assert.equal(parseTelnyxFaxWebhookEnvelope({}), null);
  assert.equal(parseTelnyxFaxWebhookEnvelope({ data: {} }), null);
  assert.equal(parseTelnyxFaxWebhookEnvelope({ data: { id: "evt-1" } }), null, "missing event_type/occurred_at/payload.fax_id");
  assert.equal(parseTelnyxFaxWebhookEnvelope({ data: { id: "evt-1", event_type: "fax.queued", occurred_at: "not-a-date", payload: { fax_id: "p-1" } } }), null, "unparseable occurred_at");
  assert.equal(parseTelnyxFaxWebhookEnvelope({ data: { id: "evt-1", event_type: "fax.queued", occurred_at: "2026-09-11T12:00:00.000Z", payload: {} } }), null, "no usable provider fax id");
  assert.equal(parseTelnyxFaxWebhookEnvelope("just a string"), null);
  assert.equal(parseTelnyxFaxWebhookEnvelope(42), null);
});

test("FAX-006: bounded fields are truncated/rejected rather than allowed to grow unboundedly", () => {
  const oversizedId = "x".repeat(200);
  assert.equal(parseTelnyxFaxWebhookEnvelope(baseEvent({ data: { id: oversizedId, event_type: "fax.queued", occurred_at: "2026-09-11T12:00:00.000Z", payload: { fax_id: "p-1" } } })), null);
  const withLongClientState = parseTelnyxFaxWebhookEnvelope(baseEvent({ payload: { client_state: "y".repeat(600) } }));
  assert.equal(withLongClientState!.clientState.length, 512);
  const withHugePageCount = parseTelnyxFaxWebhookEnvelope(baseEvent({ payload: { page_count: 999999999 } }));
  assert.equal(withHugePageCount!.pageCount, null, "an out-of-bounds page count is dropped, not clamped or trusted");
  const withNegativePageCount = parseTelnyxFaxWebhookEnvelope(baseEvent({ payload: { page_count: -1 } }));
  assert.equal(withNegativePageCount!.pageCount, null);
});

test("FAX-006: media_url is captured only as a bounded transient field, never treated as a durable document reference by this module", () => {
  const envelope = parseTelnyxFaxWebhookEnvelope(baseEvent({ payload: { media_url: "https://telnyx.example/fax/media/abc123" } }));
  assert.equal(envelope!.transientMediaUrl, "https://telnyx.example/fax/media/abc123");
});

// --- client_state correlation -----------------------------------------------

test("FAX-006: a valid opaque correlation token round-trips through canonical base64 client_state", () => {
  const token = generateProviderCorrelationToken();
  const clientState = Buffer.from(token, "utf8").toString("base64");
  assert.equal(decodeTelnyxClientStateCorrelationToken(clientState), token);
});

test("FAX-006: invalid client_state is rejected without throwing and without ever surfacing decoded content", () => {
  assert.equal(decodeTelnyxClientStateCorrelationToken(""), null);
  assert.equal(decodeTelnyxClientStateCorrelationToken("not-valid-base64!!!"), null);
  assert.equal(decodeTelnyxClientStateCorrelationToken("x".repeat(600)), null, "oversized client_state is rejected before decoding");
  // Valid base64 that decodes to something that is not a plausible opaque token shape.
  assert.equal(decodeTelnyxClientStateCorrelationToken(Buffer.from("not a token, just some text; DROP TABLE faxes;", "utf8").toString("base64")), null);
  assert.equal(decodeTelnyxClientStateCorrelationToken(Buffer.from("+15557654321", "utf8").toString("base64")), null, "a phone-number-shaped decoded value must never be accepted as a token");
});

// --- Local fax resolution and event processing ------------------------------

function setUpOutboundFax(database: PhoneDatabase, localFaxId: string, opts: { bindProvider?: boolean; providerFaxId?: string } = {}) {
  database.createFax({ local_fax_id: localFaxId, direction: "outbound", to_number: "+15557654321" });
  database.createFaxDocument({ fax_id: localFaxId, local_ref: "synthetic-fax.pdf", content_type: "application/pdf" });
  database.applyFaxState(localFaxId, "prepared");
  database.applyFaxState(localFaxId, "submission_pending");
  database.applyFaxState(localFaxId, "submitting");
  if (opts.bindProvider !== false) database.bindFaxProvider(localFaxId, "telnyx");
  if (opts.providerFaxId) database.bindFaxProviderIdentity(localFaxId, "telnyx", opts.providerFaxId);
}

function ingressRow(overrides: Partial<TelnyxFaxWebhookEventRow> = {}): TelnyxFaxWebhookEventRow {
  return {
    event_id: "evt-1", event_type: "fax.queued", occurred_at: "2026-09-11T12:00:00.000Z",
    received_at: "2026-09-11T12:00:01.000Z", signed_at: "2026-09-11T12:00:00.000Z", attempt: 1,
    provider_fax_id: "provider-fax-1", direction: "outbound", client_state: "", page_count: null,
    failure_category: "", transient_media_url: "", delivery_target_hash: "", payload_sha256: "hash-1",
    local_fax_id: null, processing_status: "pending", bounded_error: "", processed_at: null,
    created_at: "2026-09-11T12:00:01.000Z", ...overrides
  };
}

test("FAX-006: a supported outbound event resolves by direct provider fax id and is recorded to the normalized ledger", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-direct-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    database.enqueueTelnyxFaxWebhookEvent(ingressRow());
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted");
    const completed = database.connection.prepare("SELECT processing_status, local_fax_id FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-1") as { processing_status: string; local_fax_id: string };
    assert.equal(completed.processing_status, "resolved");
    assert.equal(completed.local_fax_id, "fax-1");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: an unresolvable outbound event (no matching provider fax id, no client_state) is marked unresolved, not lost or failed", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-unresolved-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-unresolved", provider_fax_id: "unknown-provider-fax-id" }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    const completed = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-unresolved") as { processing_status: string };
    assert.equal(completed.processing_status, "unresolved");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: client_state correlation resolves and binds the provider identity when no direct provider fax id match exists yet", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-correlation-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1"); // provider bound, but no provider_fax_id yet
    const token = generateProviderCorrelationToken();
    database.setFaxProviderCorrelationToken("fax-1", token);
    const clientState = Buffer.from(token, "utf8").toString("base64");
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-correlated", client_state: clientState }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.provider_fax_id, "provider-fax-1", "resolving via client_state must also bind the now-known provider fax id");
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted");
    const completed = database.connection.prepare("SELECT processing_status, local_fax_id FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-correlated") as { processing_status: string; local_fax_id: string };
    assert.equal(completed.processing_status, "resolved");
    assert.equal(completed.local_fax_id, "fax-1");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: an invalid client_state cannot resolve a fax by correlation and never leaks decoded content", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-bad-correlation-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1");
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-bad-correlation", client_state: Buffer.from("not-a-real-token", "utf8").toString("base64") }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.provider_fax_id, null);
    const completed = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-bad-correlation") as { processing_status: string };
    assert.equal(completed.processing_status, "unresolved", "an event that cannot be resolved must stay unresolved, never guessed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: an authentic-but-unsupported event type is durably classified as unsupported and never guessed into lifecycle state", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-unsupported-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-unsupported", event_type: "fax.some.future.event" }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "submitting", "an unsupported event must never mutate fax lifecycle state");
    const completed = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-unsupported") as { processing_status: string };
    assert.equal(completed.processing_status, "unsupported");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: invalid/missing direction never mutates local fax state, even when the provider fax id resolves", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-invalid-direction-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-no-direction", direction: "" }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "submitting");
    const completed = database.connection.prepare("SELECT processing_status, bounded_error FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-no-direction") as { processing_status: string; bounded_error: string };
    assert.equal(completed.processing_status, "failed");
    assert.equal(completed.bounded_error, "invalid_direction");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: a provider-reported direction mismatched against the local fax's own direction fails closed without mutating state", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-direction-mismatch-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    // The webhook claims this provider fax id is inbound, but locally it is outbound.
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-dir-mismatch", direction: "inbound", event_type: "fax.failed" }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "submitting", "must not be mutated into failed by a mismatched-direction observation");
    const completed = database.connection.prepare("SELECT processing_status, bounded_error FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-dir-mismatch") as { processing_status: string; bounded_error: string };
    assert.equal(completed.processing_status, "failed");
    assert.equal(completed.bounded_error, "direction_mismatch");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: inbound events are durably deferred without any local fax lookup/creation/mutation (Phase 3/4 boundary)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-inbound-deferred-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    for (const eventType of ["fax.receiving.started", "fax.media.processing.started", "fax.received"]) {
      const eventId = `evt-inbound-${eventType}`;
      database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: eventId, event_type: eventType, direction: "inbound", provider_fax_id: `inbound-${eventType}` }));
      const row = database.pendingTelnyxFaxWebhookEvents().find((r) => r.event_id === eventId)!;
      processTelnyxFaxWebhookEvent(row, database);
      const completed = database.connection.prepare("SELECT processing_status, local_fax_id FROM telnyx_fax_webhook_events WHERE event_id=?").get(eventId) as { processing_status: string; local_fax_id: string | null };
      assert.equal(completed.processing_status, "deferred_inbound");
      assert.equal(completed.local_fax_id, null, "Phase 3 must never create or attach a local fax for inbound reception");
    }
    assert.equal(database.faxes({ direction: "inbound" }).length, 0, "no inbound fax row was ever created by webhook processing");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: a duplicate normalized event remains idempotent in the fax_events ledger", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-duplicate-ledger-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-dup-1" }));
    const first = database.pendingTelnyxFaxWebhookEvents()[0];
    processTelnyxFaxWebhookEvent(first, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted");

    // A second ingress row carrying the identical underlying provider event id
    // (Telnyx re-delivering) must not double-apply the observation.
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-dup-1" })); // INSERT OR IGNORE: no new row
    assert.equal(database.pendingTelnyxFaxWebhookEvents().length, 0, "the duplicate ingress insert must be ignored, not requeued");

    // Directly exercise the ledger's own dedup for the same (provider, event_id).
    const repeat = database.recordFaxEvent({ provider: "telnyx", event_id: "evt-dup-1", fax_id: "fax-1", normalized_state: "accepted", occurred_at: "2026-09-11T12:00:00.000Z" });
    assert.deepEqual(repeat, { recorded: false, applied: false });
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: an out-of-order (earlier) event never regresses a later authoritative state", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-out-of-order-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-delivered", event_type: "fax.delivered", occurred_at: "2026-09-11T12:05:00.000Z" }));
    processTelnyxFaxWebhookEvent(database.pendingTelnyxFaxWebhookEvents()[0], database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");

    // An older fax.queued event arrives late.
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-queued-late", event_type: "fax.queued", occurred_at: "2026-09-11T12:00:00.000Z" }));
    processTelnyxFaxWebhookEvent(database.pendingTelnyxFaxWebhookEvents()[0], database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered", "an older event must never regress the already-delivered state");
    const completed = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-queued-late") as { processing_status: string };
    assert.equal(completed.processing_status, "resolved", "the event is still durably resolved/recorded even though it did not advance state");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: two concurrent forward observations converge to the later authoritative state, neither lost", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-concurrent-forward-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    // Two workers each observe a forward-of-current state, "sending" and
    // "delivered" respectively; regardless of processing order, the final
    // state must be the more-advanced "delivered", and both events must be
    // durably recorded (never a false/lost outcome for either).
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-sending", event_type: "fax.sending.started", occurred_at: "2026-09-11T12:01:00.000Z" }));
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-delivered", event_type: "fax.delivered", occurred_at: "2026-09-11T12:02:00.000Z" }));
    for (const row of database.pendingTelnyxFaxWebhookEvents()) processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
    const sendingRow = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-sending") as { processing_status: string };
    const deliveredRow = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-delivered") as { processing_status: string };
    assert.equal(sendingRow.processing_status, "resolved");
    assert.equal(deliveredRow.processing_status, "resolved");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: unknown failure_reason values map to a generic safe category, and internal_failure_reason is never read by this module", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-failure-reason-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    const envelope = parseTelnyxFaxWebhookEnvelope({
      data: { id: "evt-failed", event_type: "fax.failed", occurred_at: "2026-09-11T12:03:00.000Z", payload: { fax_id: "provider-fax-1", direction: "outbound", failure_reason: "a_brand_new_unlisted_reason", internal_failure_reason: "stack trace: NPE at FaxWorker.java:412" } }
    });
    assert.equal(envelope!.failureCategory, "unknown");
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-failed", event_type: "fax.failed", occurred_at: "2026-09-11T12:03:00.000Z", failure_category: envelope!.failureCategory }));
    processTelnyxFaxWebhookEvent(database.pendingTelnyxFaxWebhookEvents()[0], database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "failed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: an internal processing error is durably classified as failed rather than left pending forever, and never throws", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-webhook-processing-error-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpOutboundFax(database, "fax-1", { providerFaxId: "provider-fax-1" });
    database.enqueueTelnyxFaxWebhookEvent(ingressRow({ event_id: "evt-throws" }));
    const row = database.pendingTelnyxFaxWebhookEvents()[0];
    const throwingDatabase: typeof database = new Proxy(database, {
      get(target, prop, receiver) {
        if (prop === "recordFaxEvent") return () => { throw new Error("simulated durability failure"); };
        return Reflect.get(target, prop, receiver);
      }
    });
    assert.doesNotThrow(() => processTelnyxFaxWebhookEvent(row, throwingDatabase));
    const completed = database.connection.prepare("SELECT processing_status, bounded_error FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-throws") as { processing_status: string; bounded_error: string };
    assert.equal(completed.processing_status, "failed");
    assert.equal(completed.bounded_error, "processing_failed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
