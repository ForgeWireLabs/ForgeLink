import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PhoneDatabase } from "./database";
import { FaxProvider, FaxProviderAmbiguousError, FaxProviderRejectionError } from "./fax";
import { generateProviderCorrelationToken, reconcileFax, requestFaxCancellation, submitFax } from "./fax-submission";
import { processTelnyxFaxWebhookEvent } from "./telnyx-fax-webhook";

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
    assert.deepEqual(first, { outcome: "accepted", providerFaxId: "provider-fax-1", state: "accepted" });
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

    const provider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", direction: "outbound" as const, normalizedState: "delivered", occurredAt: "2026-09-10T22:10:00Z" }) });
    const advanced = await reconcileFax("fax-1", { database, provider });
    assert.deepEqual(advanced, { outcome: "advanced", state: "delivered" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");

    const staleProvider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", direction: "outbound" as const, normalizedState: "accepted", occurredAt: "2026-09-10T21:00:00Z" }) });
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

    const reconcileProvider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", direction: "outbound" as const, normalizedState: "delivered", occurredAt: "2026-09-10T22:20:00Z" }) });
    const outcome = await reconcileFax("fax-1", { database, provider: reconcileProvider });
    assert.deepEqual(outcome, { outcome: "advanced", state: "delivered" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Phase 2.1 finding 1: cancellation claim/rollback correctness ---

test("FAX-005 (2.1): cancellation without a known provider fax id never enters cancel_pending", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-noid-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "ambiguous"); // no provider_fax_id was ever captured
    let cancelCalled = false;
    const provider = fakeProvider({ cancelFax: async (id) => { cancelCalled = true; return { providerFaxId: id, normalizedState: "cancel_pending" }; } });
    const outcome = await requestFaxCancellation("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "unsupported" });
    assert.equal(cancelCalled, false);
    assert.equal(database.faxByLocalId("fax-1")!.state, "ambiguous", "the fax must not be mutated into cancel_pending");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): cancellation against a provider that does not implement cancelFax never enters cancel_pending", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-unsupported-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    const provider = fakeProvider({ cancelFax: undefined });
    const outcome = await requestFaxCancellation("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "unsupported" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted", "the fax must not be mutated into cancel_pending");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): an ambiguous cancel outcome leaves the fax in cancel_pending because provider acceptance is unknown", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-ambiguous-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    const provider = fakeProvider({ cancelFax: async () => { throw new FaxProviderAmbiguousError("network_error", "timeout"); } });
    const outcome = await requestFaxCancellation("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "ambiguous" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "cancel_pending", "acceptance cannot be excluded, so the claim must stand");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): an explicit 404 cancel rejection safely restores the prior accepted state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-404-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    const provider = fakeProvider({ cancelFax: async () => { throw new FaxProviderRejectionError("not_found", "Telnyx has no record of this fax to cancel."); } });
    const outcome = await requestFaxCancellation("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "rejected", category: "not_found" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted", "the prior state must be restored, not left in cancel_pending");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): an explicit 422 (no-longer-cancellable) rejection safely restores the prior sending state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-422-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    database.applyFaxState("fax-1", "sending");
    const provider = fakeProvider({ cancelFax: async () => { throw new FaxProviderRejectionError("90000", "Telnyx rejected the cancel request; the fax may no longer be cancellable."); } });
    const outcome = await requestFaxCancellation("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "rejected", category: "90000" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "sending", "the prior state (sending) must be restored");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): the cancellation rollback CAS cannot overwrite a concurrently advanced terminal state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-race-terminal-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    database.applyFaxState("fax-1", "cancel_pending");
    // Simulates a provider observation racing in and resolving the fax to a
    // terminal state (e.g. a webhook/GET reconciliation) before the pending
    // cancel rejection is processed.
    database.applyFaxObservation("fax-1", "delivered", { providerFaxId: "provider-fax-1" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");

    // The rollback attempt (as requestFaxCancellation would perform on a
    // rejection) must be a harmless no-op now that the row is no longer
    // cancel_pending.
    const restored = database.restoreCancelClaim("fax-1", "accepted");
    assert.equal(restored, false, "the CAS rollback must fail harmlessly, not overwrite the terminal state");
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered", "the terminal state must be preserved");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): duplicate cancellation callers still issue at most one provider cancel command", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-cancel-dup-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    let cancelCount = 0;
    const provider = fakeProvider({ cancelFax: async (id) => { cancelCount += 1; return { providerFaxId: id, normalizedState: "cancel_pending" }; } });
    const [first, second] = await Promise.all([
      requestFaxCancellation("fax-1", { database, provider }),
      requestFaxCancellation("fax-1", { database, provider })
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    assert.deepEqual(outcomes, ["claimed", "not_claimed"]);
    assert.equal(cancelCount, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Phase 2.1 finding 2: reconciliation direction verification ---

test("FAX-005 (2.1): a provider observation reporting the wrong direction cannot mutate the local fax, including into failed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-reconcile-direction-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database); // outbound
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    // The provider claims this provider fax id is actually an inbound fax
    // reporting "failed" -- "failed" is legal in both graphs, so state
    // compatibility alone would not catch this.
    const provider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", direction: "inbound" as const, normalizedState: "failed", occurredAt: "2026-09-10T22:30:00Z" }) });
    const outcome = await reconcileFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "direction_mismatch" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted", "the local outbound fax must not become failed from a mismatched-direction observation");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): the inverse direction mismatch (local inbound, provider reports outbound) also cannot mutate state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-reconcile-direction-inverse-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    database.createFax({ local_fax_id: "fax-in-1", direction: "inbound", to_number: "+15550001111", from_number: "+15557654321", provider: "telnyx", provider_fax_id: "provider-fax-in-1" });
    const provider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-in-1", direction: "outbound" as const, normalizedState: "failed", occurredAt: "2026-09-10T22:31:00Z" }) });
    const outcome = await reconcileFax("fax-in-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "direction_mismatch" });
    assert.equal(database.faxByLocalId("fax-in-1")!.state, "receiving", "the local inbound fax must not be mutated from a mismatched-direction observation");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005 (2.1): a correctly-matching direction still reconciles normally", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-reconcile-direction-ok-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    database.applyFaxState("fax-1", "submitting");
    database.applyFaxState("fax-1", "accepted", { providerFaxId: "provider-fax-1" });
    const provider = fakeProvider({ getFax: async () => ({ providerFaxId: "provider-fax-1", direction: "outbound" as const, normalizedState: "delivered", occurredAt: "2026-09-10T22:32:00Z" }) });
    const outcome = await reconcileFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "advanced", state: "delivered" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Phase 2.1 finding 5: correlation token persistence must succeed before any provider call ---

test("FAX-005 (2.1): a correlation token persistence failure prevents the provider from being invoked and produces a definite failed outcome, not ambiguous", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-token-fail-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database);
    let sendCalled = false;
    const provider = fakeProvider({ sendFax: async () => { sendCalled = true; return { providerFaxId: "provider-fax-1", normalizedState: "accepted" }; } });
    // Wrap the real database so setFaxProviderCorrelationToken reports failure
    // (simulates a token collision or a durability failure), while every
    // other method delegates to the real PhoneDatabase.
    const flaky: typeof database = new Proxy(database, {
      get(target, prop, receiver) {
        if (prop === "setFaxProviderCorrelationToken") return () => false;
        return Reflect.get(target, prop, receiver);
      }
    });
    const outcome = await submitFax("fax-1", { database: flaky, provider });
    assert.deepEqual(outcome, { outcome: "failed", category: "correlation_token_unavailable" });
    assert.equal(sendCalled, false, "the provider must never be invoked when the correlation token cannot be durably established");
    assert.equal(database.faxByLocalId("fax-1")!.state, "failed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Phase 3 prerequisite: provider ownership binding before any provider call ---

test("FAX-006: submitFax binds the fax to the provider before ever invoking it, and fails closed with no provider call on a mismatch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-provider-mismatch-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database, "fax-mismatch");
    // A fax already bound to a different provider (e.g. a future second fax edge).
    database.bindFaxProvider("fax-mismatch", "some-other-fax-provider");
    let sendCalled = false;
    const provider = fakeProvider({ sendFax: async () => { sendCalled = true; return { providerFaxId: "provider-fax-1", normalizedState: "accepted" }; } });
    const outcome = await submitFax("fax-mismatch", { database, provider });
    assert.deepEqual(outcome, { outcome: "failed", category: "provider_mismatch" });
    assert.equal(sendCalled, false, "the provider must never be invoked once a binding mismatch is detected");
    assert.equal(database.faxByLocalId("fax-mismatch")!.state, "failed");
    assert.equal(database.faxByLocalId("fax-mismatch")!.provider, "some-other-fax-provider", "the existing binding must not be overwritten");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: submitFax binds an unbound fax to the invoked provider before calling it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-provider-bind-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database, "fax-1");
    assert.equal(database.faxByLocalId("fax-1")!.provider, "");
    let providerAtSendTime: string | undefined;
    const provider = fakeProvider({
      sendFax: async () => {
        providerAtSendTime = database.faxByLocalId("fax-1")!.provider;
        return { providerFaxId: "provider-fax-1", normalizedState: "accepted" };
      }
    });
    await submitFax("fax-1", { database, provider });
    assert.equal(providerAtSendTime, "telnyx", "the provider binding must already be durable before the provider is invoked");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: a provider identity conflict after send resolves to ambiguous rather than silently overwriting the existing binding", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-identity-conflict-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database, "fax-1");
    // Another fax already owns this exact provider fax id under the same provider
    // (a pathological/duplicate provider response).
    database.createFax({ local_fax_id: "fax-already-owns-it", direction: "outbound", to_number: "+15557654322" });
    database.bindFaxProvider("fax-already-owns-it", "telnyx");
    database.bindFaxProviderIdentity("fax-already-owns-it", "telnyx", "provider-fax-1");

    const provider = fakeProvider({ sendFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted" }) });
    const outcome = await submitFax("fax-1", { database, provider });
    assert.deepEqual(outcome, { outcome: "ambiguous", category: "provider_identity_conflict" });
    assert.equal(database.faxByLocalId("fax-1")!.state, "ambiguous");
    assert.equal(database.faxByLocalId("fax-1")!.provider_fax_id, null, "the conflicting id must never be attached to this fax");
    assert.equal(database.faxByLocalId("fax-already-owns-it")!.provider_fax_id, "provider-fax-1", "the original binding must be untouched");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006: onProviderFaxIdBound fires exactly once, after the identity is durably bound, with the correct provider and id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-submission-bound-hook-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database, "fax-1");
    const calls: Array<{ provider: string; providerFaxId: string; boundAtCallTime: string | null }> = [];
    const provider = fakeProvider({ sendFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted" }) });
    await submitFax("fax-1", {
      database, provider,
      onProviderFaxIdBound: (p, id) => calls.push({ provider: p, providerFaxId: id, boundAtCallTime: database.faxByLocalId("fax-1")!.provider_fax_id })
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { provider: "telnyx", providerFaxId: "provider-fax-1", boundAtCallTime: "provider-fax-1" });
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// --- Phase 3: POST-response vs. webhook race convergence (FAX-006) ---------
//
// Both directions of the race described in the mission: a valid webhook may
// authentically arrive either before or after submitFax's own POST response
// has bound the provider fax id, and either ordering must converge to the
// truthful state without waiting for a restart.

function ingressEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "evt-race-1", event_type: "fax.delivered", occurred_at: "2026-09-11T12:05:00.000Z",
    received_at: "2026-09-11T12:05:01.000Z", signed_at: "2026-09-11T12:05:00.000Z", attempt: 1,
    provider_fax_id: "provider-fax-1", direction: "outbound", client_state: "", page_count: null,
    failure_category: "", transient_media_url: "", delivery_target_hash: "", payload_sha256: "hash-race",
    local_fax_id: null, processing_status: "pending" as const, bounded_error: "", processed_at: null,
    created_at: "2026-09-11T12:05:01.000Z", ...overrides
  };
}

test("FAX-006 race: a webhook that arrives before the POST response resolves immediately once onProviderFaxIdBound fires, without a restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-race-webhook-first-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database, "fax-1");
    // The webhook (fax.delivered) arrives first, before the provider fax id
    // is known locally -- it can only resolve to "unresolved".
    database.enqueueTelnyxFaxWebhookEvent(ingressEvent());
    processTelnyxFaxWebhookEvent(database.pendingTelnyxFaxWebhookEvents()[0], database);
    const unresolvedStatus = (database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-race-1") as { processing_status: string } | undefined)?.processing_status;
    assert.equal(unresolvedStatus, "unresolved");

    // The POST response now binds the provider fax id; the hook reprocesses
    // any events that had been waiting on exactly this provider fax id.
    const provider = fakeProvider({ sendFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted" }) });
    const outcome = await submitFax("fax-1", {
      database, provider,
      onProviderFaxIdBound: (_p, providerFaxId) => {
        for (const row of database.unresolvedTelnyxFaxWebhookEventsByProviderFaxId(providerFaxId)) processTelnyxFaxWebhookEvent(row, database);
      }
    });
    assert.equal(outcome.outcome, "accepted");
    // The webhook's fax.delivered observation must win over submitFax's own
    // "accepted" observation (Phase 1.1 monotonic reconciliation) -- this is
    // exactly the truthful-current-state contract submitFax promises.
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
    const finalStatus = (database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-race-1") as { processing_status: string }).processing_status;
    assert.equal(finalStatus, "resolved");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006 race: a webhook that arrives after the POST response has already bound the provider fax id resolves immediately on its own", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-race-post-first-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    setUpFax(database, "fax-1");
    const provider = fakeProvider({ sendFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted" }) });
    const outcome = await submitFax("fax-1", { database, provider });
    assert.equal(outcome.outcome, "accepted");
    assert.equal(database.faxByLocalId("fax-1")!.provider_fax_id, "provider-fax-1");

    // Now the webhook arrives; the provider fax id is already bound, so
    // direct resolution succeeds without any special-cased handling.
    database.enqueueTelnyxFaxWebhookEvent(ingressEvent());
    processTelnyxFaxWebhookEvent(database.pendingTelnyxFaxWebhookEvents()[0], database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
    const status = (database.connection.prepare("SELECT processing_status FROM telnyx_fax_webhook_events WHERE event_id=?").get("evt-race-1") as { processing_status: string }).processing_status;
    assert.equal(status, "resolved");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-006 race: restart drain resolves an event that was left unresolved even without the onProviderFaxIdBound hook firing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-race-restart-drain-"));
  const path = join(directory, "phone.sqlite3");
  let database: PhoneDatabase | undefined = new PhoneDatabase(path);
  try {
    setUpFax(database, "fax-1");
    database.enqueueTelnyxFaxWebhookEvent(ingressEvent());
    processTelnyxFaxWebhookEvent(database.pendingTelnyxFaxWebhookEvents()[0], database);
    const provider = fakeProvider({ sendFax: async () => ({ providerFaxId: "provider-fax-1", normalizedState: "accepted" }) });
    // No onProviderFaxIdBound hook this time -- simulates a restart between
    // the webhook arriving and the provider fax id becoming known.
    await submitFax("fax-1", { database, provider });
    assert.equal(database.faxByLocalId("fax-1")!.state, "accepted", "without the hook or a restart sweep, the event correctly remains unresolved for now");

    database.close();
    database = new PhoneDatabase(path);
    // Startup recovery sweep (mirrors server.ts's drainUnresolvedTelnyxFaxWebhookEvents).
    for (const row of database.unresolvedTelnyxFaxWebhookEvents()) processTelnyxFaxWebhookEvent(row, database);
    assert.equal(database.faxByLocalId("fax-1")!.state, "delivered");
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
});
