import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhoneDatabase } from "./database";
import { FaxProvider, FaxProviderAmbiguousError, FaxProviderRejectionError } from "./fax";
import { generateProviderCorrelationToken, reconcileFax, requestFaxCancellation, submitFax } from "./fax-submission";

function fakeProvider(overrides: Partial<FaxProvider> = {}): FaxProvider {
  return {
    capabilities: () => ({ kind: "fax_edge", provider: "telnyx", displayName: "Telnyx Fax", capabilities: ["fax_send", "fax_status", "fax_cancel"] }),
    validateCredentials: async () => ({ ok: true }),
    sendFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted" }),
    ...overrides
  };
}

function setUpFax(database: PhoneDatabase, localFaxId = "fax-1") {
  database.createFax({ local_fax_id: localFaxId, direction: "outbound", to_number: "+15557654321" });
  database.createFaxDocument({ fax_id: localFaxId, local_ref: "synthetic-fax.pdf", content_type: "application/pdf" });
  database.applyFaxState(localFaxId, "prepared");
  database.applyFaxState(localFaxId, "submission_pending");
}

test("FAX-005: the CAS winner sends exactly once; a second submission caller does not send", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    let sendCount = 0;
    const provider = fakeProvider({ sendFax: async () => { sendCount += 1; return { providerFaxId: "provider-fax-1", normalizedState: "accepted" }; } });

    const first = await submitFax("fax-1", { database, provider });
    assert.deepEqual(first, { outcome: "accepted", providerFaxId: "provider-fax-1" });
    assert.equal(sendCount, 1);
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted");
    assert.equal(database.faxByLocalId("fax-1")!.provider_fax_id, "provider-fax-1");

    // A second caller racing the same fax (now already accepted) must not
    // send a second time -- its own CAS claim attempt fails cleanly.
    const second = await submitFax("fax-1", { database, provider });
    assert.deepEqual(second, { outcome: "not_claimed" });
    assert.equal(sendCount, 1, "a second submission attempt must not invoke the provider");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: every nonterminal/terminal state other than submission_pending refuses a new claim without sending", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-states-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    let sendCount = 0;
    const provider = fakeProvider({ sendFax: async () => { sendCount += 1; return { providerFaxId: "p-1", normalizedState: "accepted" }; } });

    // draft (never reached submission_pending) cannot be claimed.
    database.createFax({ local_fax_id: "fax-draft", direction: "outbound", to_number: "+15557654321" });
    assert.deepEqual(await submitFax("fax-draft", { database, provider }), { outcome: "not_claimed" });

    // Already-accepted fax cannot be reclaimed.
    setUpFax(database, "fax-accepted");
    database.applyFaxState("fax-accepted", "submitting");
    database.applyFaxState("fax-accepted", "accepted", { providerFaxId: "already-accepted" });
    assert.deepEqual(await submitFax("fax-accepted", { database, provider }), { outcome: "not_claimed" });

    // ambiguous (e.g. after a restart) must never be auto-resent.
    setUpFax(database, "fax-ambiguous");
    database.applyFaxState("fax-ambiguous", "submitting");
    database.applyFaxState("fax-ambiguous", "ambiguous");
    assert.deepEqual(await submitFax("fax-ambiguous", { database, provider }), { outcome: "not_claimed" });

    assert.equal(sendCount, 0, "no provider invocation occurred for any of these non-submission_pending faxes");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: a restart with a fax left in ambiguous state does not resend on any later submitFax call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-restart-"));
  const path = join(directory, "phone.sqlite3");
  let database: PhoneDatabase | undefined = new PhoneDatabase(path);
  try {
    setUpFax(database, "fax-restart-1");
    database.applyFaxState("fax-restart-1", "submitting");
    database.applyFaxState("fax-restart-1", "ambiguous");
    database.close();

    // Simulates an app restart while a fax sits ambiguous.
    database = new PhoneDatabase(path);
    let sendCount = 0;
    const provider = fakeProvider({ sendFax: async () => { sendCount += 1; return { providerFaxId: "p-1", normalizedState: "accepted" }; } });
    const outcome = await submitFax("fax-restart-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "not_claimed" });
    assert.equal(sendCount, 0);
    assert.equal(database.faxByLocalId("fax-restart-1")!.state, "ambiguous", "restart must not silently resolve or resend an ambiguous fax");
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: an explicit provider rejection moves the fax to failed with a bounded category", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-rejected-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    const provider = fakeProvider({ sendFax: async () => { throw new FaxProviderRejectionError("10002", "Telnyx rejected the fax request (422)."); } });
    const outcome = await submitFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "failed", category: "10002" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "failed");
    assert.equal(database.faxByLocalId("fax-1")!.failure_category, "10002");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: an ambiguous provider outcome moves the fax to ambiguous, never failed or accepted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-ambiguous-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    const provider = fakeProvider({ sendFax: async () => { throw new FaxProviderAmbiguousError("network_error", "Could not confirm whether Telnyx received the fax request."); } });
    const outcome = await submitFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "ambiguous", category: "network_error" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "ambiguous");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: a provider result with no usable provider id is treated as ambiguous even though the call nominally succeeded", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-noid-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    const provider = fakeProvider({ sendFax: async () => ({ providerFaxId: null, normalizedState: "accepted" }) });
    const outcome = await submitFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "ambiguous", category: "missing_provider_id" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "ambiguous");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: submission fails closed before any provider call when no document is attached", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-nodoc-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    database.createFax({ local_fax_id: "fax-nodoc", direction: "outbound", to_number: "+15557654321" });
    database.applyFaxState("fax-nodoc", "prepared");
    database.applyFaxState("fax-nodoc", "submission_pending");
    let sendCount = 0;
    const provider = fakeProvider({ sendFax: async () => { sendCount += 1; return { providerFaxId: "p-1", normalizedState: "accepted" }; } });
    const outcome = await submitFax("fax-nodoc", { database, provider });
    assert.deepEqual(outcome, { outcome: "failed", category: "missing_document" });
    assert.equal(sendCount, 0);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: the opaque provider correlation token is generated locally and durably associated with the fax before the provider is called", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-token-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    let tokenAtSendTime: string | undefined;
    const provider = fakeProvider({
      sendFax: async (request) => {
        tokenAtSendTime = request.correlation;
        // The token must already be durably persisted before the provider is invoked.
        assert.equal(database.faxByLocalId("fax-1")!.provider_correlation_token, request.correlation);
        return { providerFaxId: "provider-fax-1", normalizedState: "accepted" };
      }
    });
    await submitFax("fax-1", { database, provider });
    assert.ok(tokenAtSendTime);
    assert.equal(database.faxByProviderCorrelationToken(tokenAtSendTime!)!.local_fax_id, "fax-1");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: the provider correlation token is opaque -- contains no recoverable private fax metadata", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const token = generateProviderCorrelationToken();
    assert.equal(seen.has(token), false, "tokens must not repeat");
    seen.add(token);
    assert.match(token, /^[A-Za-z0-9_-]{20,}$/, "token must be an opaque base64url string, not a recognizable phone number/filename/name");
    assert.doesNotMatch(token, /\+1|@|\.pdf|\.tiff/i);
  }
});

test("FAX-005: GET reconciliation advances state on a valid observation and leaves a stale one unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-reconcile-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });

    const provider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "delivered", occurredAt: "2026-09-10T22:10:00Z" }) });
    const advanced = await reconcileFax("fax-1", { database, provider });
    assert.deepEqual(advanced, { outcome: "advanced", state: "delivered" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");

    const staleProvider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted", occurredAt: "2026-09-10T21:00:00Z" }) });
    const stale = await reconcileFax("fax-1", { database, provider: staleProvider });
    assert.deepEqual(stale, { outcome: "unchanged" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered", "a stale observation must not regress the delivered state");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: reconciliation with no known provider fax id cannot resolve the fax", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-reconcile-noid-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "ambiguous");
    const provider = fakeProvider({ getFax: async () => { throw new Error("must not be called without a provider fax id"); } });
    const outcome = await reconcileFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "no_provider_id" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "ambiguous");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: reconciliation never regresses on an unrecognized/erroring GET, and does not mutate on an ambiguous reconciliation attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-reconcile-error-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    const provider = fakeProvider({ getFax: async () => { throw new FaxProviderAmbiguousError("network_error", "timeout"); } });
    const outcome = await reconcileFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "unchanged" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: cancellation claims cancel_pending locally and issues the provider cancel command, without ever setting a terminal cancelled state itself", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    let cancelCalledWith: string | undefined;
    const provider = fakeProvider({ cancelFax: async (id) => { cancelCalledWith = id; return { providerFaxId: id, normalizedState: "cancel_pending" }; } });
    const outcome = await requestFaxCancellation("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "claimed" });
    assert.equal(cancelCalledWith, "provider-fax-1");
    assert.equal(database.faxByLocalId("fax-1")!.state, "cancel_pending");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: a second cancellation request on an already cancel_pending fax is not claimed again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-twice-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    let cancelCount = 0;
    const provider = fakeProvider({ cancelFax: async (id) => { cancelCount += 1; return { providerFaxId: id, normalizedState: "cancel_pending" }; } });
    assert.deepEqual(await requestFaxCancellation("fax-1", { database, provider }), { outcome: "claimed" });
    assert.deepEqual(await requestFaxCancellation("fax-1", { database, provider }), { outcome: "not_claimed" });
    assert.equal(cancelCount, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: a cancellation race can still converge to an authoritative delivered outcome via reconciliation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-race-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    const cancelProvider = fakeProvider({ cancelFax: async (id) => ({ providerFaxId: id, normalizedState: "cancel_pending" }) });
    await requestFaxCancellation("fax-1", { database, provider: cancelProvider });
    assert.equal(database.faxByLocalId("fax-1")!.state, "cancel_pending");

    const reconcileProvider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "delivered", occurredAt: "2026-09-10T22:20:00Z" }) });
    const outcome = await reconcileFax("fax-1", { database, provider: reconcileProvider });
    assert.deepEqual(outcome, { outcome: "advanced", state: "delivered" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
