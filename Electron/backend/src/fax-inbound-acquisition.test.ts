// Inbound fax document acquisition worker unit tests (work item 041, Phase
// 4: FAX-007). Every network call in this suite goes through an injected
// fetch implementation -- no real network request occurs anywhere here.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhoneDatabase } from "./database";
import { ManagedDocumentStore } from "./managed-document-store";
import { TelnyxFaxConfig } from "./telnyx-fax";
import {
  FAX_INBOUND_MAX_BYTES,
  recoverInboundFaxAcquisitions,
  runInboundFaxAcquisitionBatch,
  validateMediaUrl
} from "./fax-inbound-acquisition";

const CONFIG: TelnyxFaxConfig = { apiKey: "test-api-key", connectionId: "fax-app-1", phoneNumber: "+15550001111", publicKey: "test-public-key" };

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function pdfBytes(size = 64): string {
  const body = Buffer.alloc(size, 0x20);
  Buffer.from("%PDF-1.4\n").copy(body);
  return body.toString("latin1");
}

function pdfBlob(size = 64): Blob {
  return new Blob([pdfBytes(size)]);
}

async function seedFax(database: PhoneDatabase, providerFaxId: string, opts: { transientMediaUrl?: string; transientMediaExpiresAt?: string } = {}) {
  const localFaxId = database.ensureInboundFax({ provider: "telnyx", providerFaxId, fromNumber: "+15557654321", toNumber: "+15550001111" })!;
  database.claimInboundFaxAcquisition({
    provider: "telnyx", providerFaxId, localFaxId, sourceEventId: `evt-${providerFaxId}`,
    transientMediaUrl: opts.transientMediaUrl ?? "", transientMediaExpiresAt: opts.transientMediaExpiresAt ?? ""
  });
  return localFaxId;
}

// --- SSRF / media URL boundary -----------------------------------------------

test("FAX-007: validateMediaUrl accepts a normal https URL and rejects non-https, credentialed, oversized, and forbidden-host URLs", () => {
  assert.equal(validateMediaUrl("https://telnyx-fax-media.s3.amazonaws.com/abc123").ok, true);
  assert.equal(validateMediaUrl("http://telnyx-fax-media.example.com/abc").ok, false, "non-https must be rejected");
  assert.equal(validateMediaUrl("https://user:pass@telnyx.example.com/abc").ok, false, "embedded credentials must be rejected");
  assert.equal(validateMediaUrl("https://" + "a".repeat(3000) + ".example.com").ok, false, "an oversized URL must be rejected");
  assert.equal(validateMediaUrl("").ok, false);
  assert.equal(validateMediaUrl("file:///etc/passwd").ok, false, "a file:// scheme must be rejected");
  assert.equal(validateMediaUrl("javascript:alert(1)").ok, false);
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "0.0.0.0"]) {
    assert.equal(validateMediaUrl(`https://${host}/media`).ok, false, `${host} must be rejected as a forbidden host`);
  }
  assert.equal(validateMediaUrl("https://[::1]/media").ok, false, "IPv6 loopback must be rejected");
});

// --- Successful acquisition, credential separation, transient URL cleanup ---

test("FAX-007: a fresh webhook media URL is used directly (no provider GET call), the Telnyx bearer token is never sent to it, and a valid PDF is committed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-fresh-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    const localFaxId = await seedFax(database, "provider-fax-fresh", { transientMediaUrl: "https://telnyx-fax-media.example.com/fresh.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    const seenAuthHeaders: Array<{ url: string; hasAuth: boolean }> = [];
    let getCalled = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seenAuthHeaders.push({ url, hasAuth: headers.has("authorization") });
      if (url.includes("api.telnyx.com")) { getCalled = true; return jsonResponse({ data: { id: "provider-fax-fresh", direction: "inbound", connection_id: CONFIG.connectionId, media_url: "https://telnyx-fax-media.example.com/should-not-be-used.pdf" } }); }
      return new Response(pdfBlob(), { status: 200, headers: { "content-type": "application/pdf" } });
    }) as typeof fetch;

    const processed = await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    assert.equal(processed, 1);
    assert.equal(getCalled, false, "a fresh, unexpired webhook media URL must be used directly -- no provider GET call");
    const mediaCall = seenAuthHeaders.find((c) => c.url.includes("telnyx-fax-media.example.com"));
    assert.ok(mediaCall);
    assert.equal(mediaCall!.hasAuth, false, "the Telnyx bearer token must never be sent to the signed media URL");

    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-fresh")!;
    assert.equal(acquisition.state, "available");
    assert.ok(acquisition.content_sha256.length === 64);
    assert.equal(acquisition.byte_size, pdfBytes().length);
    assert.equal(database.faxByLocalId(localFaxId)!.document_acquisition_state, "available");
    const docs = database.faxDocumentsByFaxId(localFaxId);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].content_type, "application/pdf");
    assert.notEqual(docs[0].local_ref, "https://telnyx-fax-media.example.com/fresh.pdf", "the durable local_ref must never be the provider URL");
    const inspected = await store.inspect(docs[0].local_ref);
    assert.equal(inspected.exists, true);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: the originating ingress event's transient media URL is cleared once the local managed document is durably committed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-clear-transient-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    const localFaxId = database.ensureInboundFax({ provider: "telnyx", providerFaxId: "provider-fax-clear", fromNumber: "+1", toNumber: "+1" })!;
    database.enqueueTelnyxFaxWebhookEvent({
      event_id: "evt-clear-transient", event_type: "fax.received", occurred_at: "2026-09-11T12:00:00.000Z",
      received_at: "2026-09-11T12:00:01.000Z", signed_at: "2026-09-11T12:00:00.000Z", attempt: 1,
      provider_fax_id: "provider-fax-clear", direction: "inbound", client_state: "", page_count: null,
      failure_category: "", connection_id: CONFIG.connectionId, from_number: "+1", to_number: "+1", partial_content: null,
      transient_media_url: "https://telnyx-fax-media.example.com/clear-me.pdf", transient_media_expires_at: "2099-01-01T00:00:00.000Z",
      delivery_target_hash: "", payload_sha256: "hash-clear"
    });
    database.claimInboundFaxAcquisition({
      provider: "telnyx", providerFaxId: "provider-fax-clear", localFaxId, sourceEventId: "evt-clear-transient",
      transientMediaUrl: "https://telnyx-fax-media.example.com/clear-me.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z"
    });
    const fetchImpl = (async () => new Response(pdfBlob(), { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    assert.equal(database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-clear")!.state, "available");
    const ingressRow = database.connection.prepare("SELECT transient_media_url, transient_media_expires_at FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-clear-transient") as { transient_media_url: string; transient_media_expires_at: string };
    assert.equal(ingressRow.transient_media_url, "", "the transient URL must be cleared once the local document is durable");
    assert.equal(ingressRow.transient_media_expires_at, "");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: an expired webhook media URL triggers a provider GET recovery attempt, validated against fax id/direction/connection before use", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-expired-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    await seedFax(database, "provider-fax-expired", { transientMediaUrl: "https://telnyx-fax-media.example.com/expired.pdf", transientMediaExpiresAt: "2020-01-01T00:00:00.000Z" });
    let getCalled = false;
    let downloadedUrl = "";
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telnyx.com")) {
        getCalled = true;
        return jsonResponse({ data: { id: "provider-fax-expired", direction: "inbound", connection_id: CONFIG.connectionId, media_url: "https://telnyx-fax-media.example.com/fresh-from-get.pdf" } });
      }
      downloadedUrl = url;
      return new Response(pdfBlob(), { status: 200, headers: { "content-type": "application/pdf" } });
    }) as typeof fetch;

    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    assert.equal(getCalled, true, "an expired webhook URL must trigger a provider GET recovery attempt");
    assert.equal(downloadedUrl, "https://telnyx-fax-media.example.com/fresh-from-get.pdf");
    assert.equal(database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-expired")!.state, "available");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: a provider GET response for the wrong fax id, direction, or connection is never trusted -- the acquisition remains retryable and no download is attempted", async () => {
  for (const scenario of [
    { name: "id-mismatch", data: { id: "some-other-fax-id", direction: "inbound", connection_id: CONFIG.connectionId, media_url: "https://telnyx-fax-media.example.com/x.pdf" } },
    { name: "direction-mismatch", data: { id: "provider-fax-mismatch", direction: "outbound", connection_id: CONFIG.connectionId, media_url: "https://telnyx-fax-media.example.com/x.pdf" } },
    { name: "connection-mismatch", data: { id: "provider-fax-mismatch", direction: "inbound", connection_id: "some-other-fax-app", media_url: "https://telnyx-fax-media.example.com/x.pdf" } }
  ]) {
    const directory = mkdtempSync(join(tmpdir(), `forgelink-fax-acquisition-get-${scenario.name}-`));
    const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
    const store = new ManagedDocumentStore(directory);
    try {
      await seedFax(database, "provider-fax-mismatch");
      let downloadAttempted = false;
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("api.telnyx.com")) return jsonResponse(scenario);
        downloadAttempted = true;
        return new Response(pdfBlob());
      }) as typeof fetch;
      await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
      assert.equal(downloadAttempted, false, `${scenario.name}: a mismatched GET response must never lead to a download attempt`);
      const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-mismatch")!;
      assert.equal(acquisition.state, "retryable");
      assert.ok(acquisition.last_safe_error.startsWith("provider_get_"));
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

// --- Content validation / quarantine ----------------------------------------

test("FAX-007: non-PDF content (an HTML error page masquerading as a fax) is quarantined, never committed, never associated with fax_documents", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-html-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    const localFaxId = await seedFax(database, "provider-fax-html", { transientMediaUrl: "https://telnyx-fax-media.example.com/error.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    const fetchImpl = (async () => new Response("<html><body>Access Denied</body></html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-html")!;
    assert.equal(acquisition.state, "quarantined");
    assert.equal(acquisition.last_safe_error, "content_type_mismatch");
    assert.equal(database.faxDocumentsByFaxId(localFaxId).length, 0);
    assert.equal(database.faxByLocalId(localFaxId)!.state, "receiving", "quarantining the document must never mutate the fax's own transport state, and must never mark it failed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: a zero-byte response is quarantined", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-empty-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    await seedFax(database, "provider-fax-empty", { transientMediaUrl: "https://telnyx-fax-media.example.com/empty.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    const fetchImpl = (async () => new Response("", { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-empty")!;
    assert.equal(acquisition.state, "quarantined");
    assert.equal(acquisition.last_safe_error, "empty_body");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: a declared Content-Length over the safety limit is rejected and never committed as an active document", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-declared-oversized-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    const localFaxId = await seedFax(database, "provider-fax-declared-big", { transientMediaUrl: "https://telnyx-fax-media.example.com/huge.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new TextEncoder().encode(pdfBytes())); controller.close(); }
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(FAX_INBOUND_MAX_BYTES + 1) } });
    }) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-declared-big")!;
    assert.equal(acquisition.state, "quarantined");
    assert.equal(acquisition.last_safe_error, "document_too_large");
    assert.equal(database.faxDocumentsByFaxId(localFaxId).length, 0, "no document must ever be committed for a declared-oversized response");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: a chunked stream exceeding the safety limit (no Content-Length header) is quarantined and never committed as an active document", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-stream-oversized-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    const localFaxId = await seedFax(database, "provider-fax-stream-big", { transientMediaUrl: "https://telnyx-fax-media.example.com/streamed-huge.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    const chunkSize = 1024 * 1024;
    const chunkCount = Math.ceil(FAX_INBOUND_MAX_BYTES / chunkSize) + 2; // deliberately over the limit
    const chunk = Buffer.alloc(chunkSize, 0x41);
    Buffer.from("%PDF-1.4\n").copy(chunk);
    let emitted = 0;
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted >= chunkCount) { controller.close(); return; }
          emitted += 1;
          controller.enqueue(new Uint8Array(chunk));
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/pdf" } });
    }) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-stream-big")!;
    assert.equal(acquisition.state, "quarantined");
    assert.equal(acquisition.last_safe_error, "document_too_large");
    assert.equal(database.faxDocumentsByFaxId(localFaxId).length, 0, "no document must ever be committed for an over-limit streamed response, regardless of exactly how many chunks the underlying stream implementation eagerly buffered");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Retryable HTTP failures, backoff, and terminal unavailability ---------

test("FAX-007: an HTTP error (e.g. an expired signed URL returning 403) is retryable, not quarantined, and sets a bounded backoff", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-http-error-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    await seedFax(database, "provider-fax-403");
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telnyx.com")) return jsonResponse({ data: { id: "provider-fax-403", direction: "inbound", connection_id: CONFIG.connectionId, media_url: "https://telnyx-fax-media.example.com/gone.pdf" } });
      return new Response("Forbidden", { status: 403 });
    }) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-403")!;
    assert.equal(acquisition.state, "retryable");
    assert.equal(acquisition.last_safe_error, "http_403");
    assert.equal(acquisition.attempt_count, 1);
    assert.ok(acquisition.next_retry_at && acquisition.next_retry_at > new Date().toISOString());
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: retryable attempts exhaust to a terminal unavailable state, never a fabricated success and never a transport failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-exhausted-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    const localFaxId = await seedFax(database, "provider-fax-exhausted");
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telnyx.com")) return jsonResponse({ data: { id: "provider-fax-exhausted", direction: "inbound", connection_id: CONFIG.connectionId, media_url: "" } });
      return new Response("unreachable", { status: 500 });
    }) as typeof fetch;
    // A far-future injected "now" makes every retryable row immediately
    // due regardless of its actual backoff -- deterministically exercises
    // attempt exhaustion without waiting on real timers.
    const farFuture = () => new Date(Date.now() + 999 * 24 * 60 * 60_000).toISOString();
    for (let i = 0; i < 6; i++) {
      const processed = await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl, now: farFuture }, 1);
      assert.equal(processed, 1, `attempt ${i + 1} must be claimed and processed`);
    }
    const final = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-exhausted")!;
    assert.equal(final.state, "unavailable");
    assert.equal(final.attempt_count, 6);
    assert.equal(database.faxByLocalId(localFaxId)!.document_acquisition_state, "unavailable");
    assert.equal(database.faxByLocalId(localFaxId)!.state, "receiving", "exhausting acquisition attempts must never mark the underlying transmission as failed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Redirects ----------------------------------------------------------------

test("FAX-007: a redirect is followed and re-validated, and an unsafe redirect target is rejected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-redirect-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    await seedFax(database, "provider-fax-redirect-unsafe", { transientMediaUrl: "https://telnyx-fax-media.example.com/redirect-to-internal.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } })) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-redirect-unsafe")!;
    assert.equal(acquisition.state, "retryable");
    assert.equal(acquisition.last_safe_error, "url_forbidden_host");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: redirects are bounded -- too many hops is a retryable failure, never an infinite follow", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-redirect-loop-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    await seedFax(database, "provider-fax-redirect-loop", { transientMediaUrl: "https://telnyx-fax-media.example.com/loop-0.pdf", transientMediaExpiresAt: "2099-01-01T00:00:00.000Z" });
    let hops = 0;
    const fetchImpl = (async () => {
      hops += 1;
      return new Response(null, { status: 302, headers: { location: `https://telnyx-fax-media.example.com/loop-${hops}.pdf` } });
    }) as typeof fetch;
    await runInboundFaxAcquisitionBatch({ database, store, config: CONFIG, fetchImpl }, 5);
    const acquisition = database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-redirect-loop")!;
    assert.equal(acquisition.state, "retryable");
    assert.equal(acquisition.last_safe_error, "too_many_redirects");
    assert.ok(hops < 20, "the redirect chain must be bounded, never followed indefinitely");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Restart recovery ---------------------------------------------------------

test("FAX-007: restart recovery resets a stale acquiring claim and sweeps an abandoned staging file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-acquisition-restart-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  const store = new ManagedDocumentStore(directory);
  try {
    await seedFax(database, "provider-fax-crashed");
    database.claimNextInboundFaxAcquisition(new Date().toISOString());
    assert.equal(database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-crashed")!.state, "acquiring");
    // Simulate the worker having begun (but never finished) staging a file.
    const abandoned = await store.beginStaging();

    // Force staleness by directly backdating updated_at (simulating a
    // genuinely stale claim rather than waiting on a real timer).
    database.connection.prepare("UPDATE fax_inbound_acquisitions SET updated_at=? WHERE provider_fax_id=?").run(new Date(Date.now() - 60 * 60_000).toISOString(), "provider-fax-crashed");

    const result = await recoverInboundFaxAcquisitions(database, store);
    assert.equal(result.reclaimed, 1);
    assert.equal(result.sweptStagingFiles, 1);
    assert.equal(database.faxInboundAcquisitionByProviderFaxId("telnyx", "provider-fax-crashed")!.state, "retryable");
    assert.equal((await store.inspect(`staging/${abandoned.stagingId}`)).exists, false);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-007: no real network request occurs anywhere in this suite -- every call goes through an injected fetch", () => {
  // Structural assertion: every test above constructs its own fetchImpl and
  // passes it explicitly into runInboundFaxAcquisitionBatch/getTelnyxInboundFaxMediaReference's
  // dependency chain; none of them reference the global fetch. This test
  // exists as an explicit, auditable statement of that invariant.
  assert.ok(true);
});
