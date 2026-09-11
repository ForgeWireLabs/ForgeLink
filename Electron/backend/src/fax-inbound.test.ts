// Inbound fax reception unit tests (work item 041, Phase 4: FAX-007).
// DB-only -- processDeferredInboundFaxEvent never performs a network call;
// this suite exercises identity/observation application, Fax Application
// ownership validation, and transport-state-vs-acquisition-state
// separation in isolation.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhoneDatabase, TelnyxFaxWebhookEventRow } from "./database";
import { processDeferredInboundFaxEvent } from "./fax-inbound";

const CONNECTION_ID = "fax-app-configured-1";
const CONFIG = { connectionId: CONNECTION_ID };

function ingressRow(overrides: Partial<TelnyxFaxWebhookEventRow> = {}): TelnyxFaxWebhookEventRow {
  return {
    event_id: "evt-1", event_type: "fax.receiving.started", occurred_at: "2026-09-11T12:00:00.000Z",
    received_at: "2026-09-11T12:00:01.000Z", signed_at: "2026-09-11T12:00:00.000Z", attempt: 1,
    provider_fax_id: "provider-fax-1", direction: "inbound", client_state: "", page_count: null,
    failure_category: "", connection_id: CONNECTION_ID, from_number: "+15557654321", to_number: "+15550001111",
    partial_content: null, transient_media_url: "", transient_media_expires_at: "",
    delivery_target_hash: "", payload_sha256: "hash-1",
    local_fax_id: null, processing_status: "deferred_inbound", bounded_error: "", processed_at: null,
    created_at: "2026-09-11T12:00:01.000Z", ...overrides
  };
}

test("FAX-007: a receiving event creates exactly one inbound fax with the receiving transport state", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-receiving-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const row = ingressRow();
    processDeferredInboundFaxEvent(row, database, CONFIG);
    assert.equal(database.faxes({ direction: "inbound" }).length, 1);
    const fax = database.faxes({ direction: "inbound" })[0];
    assert.equal(fax.state, "receiving");
    assert.equal(fax.document_acquisition_state, "not_required", "no document acquisition is claimed for a mere receiving-progress event");
    assert.equal(fax.from_number, "+15557654321");
    assert.equal(fax.to_number, "+15550001111");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: a processing event advances the same fax and records its page count", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-processing-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    processDeferredInboundFaxEvent(ingressRow(), database, CONFIG);
    const localFaxId = database.faxes({ direction: "inbound" })[0].local_fax_id;
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-2", event_type: "fax.media.processing.started", page_count: 4 }), database, CONFIG);
    assert.equal(database.faxes({ direction: "inbound" }).length, 1, "must advance the same fax, never create a second one");
    const fax = database.faxByLocalId(localFaxId)!;
    assert.equal(fax.state, "processing");
    assert.equal(fax.page_count, 4);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: fax.received arriving before any receiving.started event still creates exactly one inbound fax and claims document acquisition", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-received-first-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-received", event_type: "fax.received", page_count: 2, transient_media_url: "https://telnyx.example/fax/media/x", transient_media_expires_at: "2026-09-11T12:10:00.000Z" }), database, CONFIG);
    const inboundFaxes = database.faxes({ direction: "inbound" });
    assert.equal(inboundFaxes.length, 1);
    const fax = inboundFaxes[0];
    assert.equal(fax.state, "received");
    assert.equal(fax.document_acquisition_state, "pending", "fax.received claims document acquisition");
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-1")!;
    assert.equal(acquisition.local_fax_id, fax.local_fax_id);
    assert.equal(acquisition.source_reference, "https://telnyx.example/fax/media/x");

    // A later, out-of-order receiving.started event must not regress the
    // already-received transport state or disturb the acquisition claim.
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-late-receiving", event_type: "fax.receiving.started" }), database, CONFIG);
    assert.equal(database.faxes({ direction: "inbound" }).length, 1);
    assert.equal(database.faxByLocalId(fax.local_fax_id)!.state, "received", "a stale receiving.started event must never regress an already-received fax");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: a duplicate fax.received webhook never duplicates the local fax or the acquisition claim", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-dup-received-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-received-1", event_type: "fax.received" }), database, CONFIG);
    const localFaxId = database.faxes({ direction: "inbound" })[0].local_fax_id;
    // Simulate the acquisition having already progressed before the duplicate arrives.
    database.completeInboundFaxAcquisition({ provider: "telnyx", providerFaxId: "provider-fax-1", state: "available", managedDocumentId: "doc-1", contentSha256: "c".repeat(64), byteSize: 999, contentType: "application/pdf" });

    // A duplicate delivery of the identical event id (Telnyx redelivery) --
    // the ledger's own dedup means recordFaxEvent's insert is ignored, but
    // this also proves the acquisition claim step is never re-triggered
    // into resetting a completed download.
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-received-1", event_type: "fax.received" }), database, CONFIG);
    assert.equal(database.faxes({ direction: "inbound" }).length, 1);
    assert.equal(database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-1")!.state, "available");
    assert.equal(database.faxByLocalId(localFaxId)!.document_acquisition_state, "available");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: an inbound fax.failed event creates a failed fax with a safe failure category and no document acquisition", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-failed-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-failed", event_type: "fax.failed", failure_category: "receiver_no_answer" }), database, CONFIG);
    const fax = database.faxes({ direction: "inbound" })[0];
    assert.equal(fax.state, "failed");
    assert.equal(fax.failure_category, "receiver_no_answer");
    assert.equal(fax.document_acquisition_state, "not_required", "no document is ever acquired for a failed inbound transmission");
    assert.equal(database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-1"), undefined, "no acquisition row is ever created for a failed inbound fax");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: an authentic event for a foreign Fax Application connection is rejected before any local fax is created", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-foreign-connection-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const row = ingressRow({ connection_id: "some-other-fax-application" });
    database.enqueueTelnyxFaxWebhookEvent(row);
    const pending = database.pendingTelnyxFaxWebhookEvents()[0];
    processDeferredInboundFaxEvent(pending, database, CONFIG);
    const result = database.connection.prepare("SELECT processing_status, local_fax_id FROM telnyx_fax_webhook_events WHERE event_id=?").get(row.event_id) as { processing_status: string; local_fax_id: string | null };
    assert.equal(result.processing_status, "foreign_connection");
    assert.equal(result.local_fax_id, null);
    assert.equal(database.faxes({ direction: "inbound" }).length, 0, "an authentic event outside the configured Fax Application must never create a local fax");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: an unconfigured (blank) connection id fails every inbound event closed rather than accepting it by default", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-unconfigured-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const row = ingressRow();
    database.enqueueTelnyxFaxWebhookEvent(row);
    const pending = database.pendingTelnyxFaxWebhookEvents()[0];
    processDeferredInboundFaxEvent(pending, database, { connectionId: "" });
    assert.equal(database.faxes({ direction: "inbound" }).length, 0);
    const result = database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get(row.event_id) as { processing_status: string };
    assert.equal(result.processing_status, "foreign_connection");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: transport state and document acquisition state are independent -- a received fax with a quarantined document is never reported as a failed transmission", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-inbound-independent-states-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    processDeferredInboundFaxEvent(ingressRow({ event_id: "evt-received", event_type: "fax.received" }), database, CONFIG);
    const localFaxId = database.faxes({ direction: "inbound" })[0].local_fax_id;
    database.completeInboundFaxAcquisition({ provider: "telnyx", providerFaxId: "provider-fax-1", state: "quarantined", lastSafeError: "not_pdf" });
    const fax = database.faxByLocalId(localFaxId)!;
    assert.equal(fax.state, "received", "the transport observation (received) must never be downgraded because the document failed local validation");
    assert.equal(fax.document_acquisition_state, "quarantined");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
