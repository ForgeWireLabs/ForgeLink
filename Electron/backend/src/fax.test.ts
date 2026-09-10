import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFaxCommandTransition,
  FAX_INITIAL_STATE,
  FAX_TERMINAL_STATES,
  FaxDirection,
  FaxRequest,
  FaxState,
  isFaxTerminalState,
  reconcileFaxObservation
} from "./fax";

// --- Direction-aware initial state and command transitions -----------------

test("outbound and inbound have distinct initial states", () => {
  assert.equal(FAX_INITIAL_STATE.outbound, "draft");
  assert.equal(FAX_INITIAL_STATE.inbound, "receiving");
});

test("legal outbound command transitions are applied in order", () => {
  const path: FaxState[] = ["draft", "prepared", "submission_pending", "submitting", "accepted", "sending", "delivered"];
  for (let i = 1; i < path.length; i++) {
    assert.equal(classifyFaxCommandTransition("outbound", path[i - 1], path[i]), "applied", `${path[i - 1]} -> ${path[i]}`);
  }
});

test("legal inbound command transitions are applied in order", () => {
  const path: FaxState[] = ["receiving", "processing", "received"];
  for (let i = 1; i < path.length; i++) {
    assert.equal(classifyFaxCommandTransition("inbound", path[i - 1], path[i]), "applied", `${path[i - 1]} -> ${path[i]}`);
  }
});

test("outbound cannot enter the inbound lifecycle", () => {
  assert.equal(classifyFaxCommandTransition("outbound", "draft", "receiving"), "illegal");
  assert.equal(classifyFaxCommandTransition("outbound", "submitting", "processing"), "illegal");
  assert.equal(classifyFaxCommandTransition("outbound", "accepted", "received"), "illegal");
});

test("inbound cannot enter the outbound submission lifecycle", () => {
  assert.equal(classifyFaxCommandTransition("inbound", "receiving", "prepared"), "illegal");
  assert.equal(classifyFaxCommandTransition("inbound", "receiving", "submission_pending"), "illegal");
  assert.equal(classifyFaxCommandTransition("inbound", "processing", "accepted"), "illegal");
});

test("a network failure after submission goes to ambiguous, not failed, and ambiguous resolves", () => {
  assert.equal(classifyFaxCommandTransition("outbound", "submitting", "ambiguous"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "ambiguous", "accepted"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "ambiguous", "failed"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "ambiguous", "cancelled"), "applied");
});

test("cancellation races: cancel_pending can still resolve to delivered or failed", () => {
  assert.equal(classifyFaxCommandTransition("outbound", "accepted", "cancel_pending"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "sending", "cancel_pending"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "cancel_pending", "cancelled"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "cancel_pending", "delivered"), "applied");
  assert.equal(classifyFaxCommandTransition("outbound", "cancel_pending", "failed"), "applied");
});

test("duplicate command transitions (same state twice) are idempotent, not errors", () => {
  assert.equal(classifyFaxCommandTransition("outbound", "submitting", "submitting"), "duplicate");
  assert.equal(classifyFaxCommandTransition("outbound", "delivered", "delivered"), "duplicate");
  assert.equal(classifyFaxCommandTransition("inbound", "receiving", "receiving"), "duplicate");
});

test("a strict local command transition cannot arbitrarily skip stages", () => {
  assert.equal(classifyFaxCommandTransition("outbound", "accepted", "delivered"), "illegal", "commands do not skip 'sending'");
  assert.equal(classifyFaxCommandTransition("outbound", "draft", "submission_pending"), "illegal", "commands do not skip 'prepared'");
  assert.equal(classifyFaxCommandTransition("inbound", "receiving", "received"), "illegal", "commands do not skip 'processing'");
});

test("regressive command transitions are rejected as illegal", () => {
  assert.equal(classifyFaxCommandTransition("outbound", "delivered", "sending"), "illegal", "cannot regress from a terminal state");
  assert.equal(classifyFaxCommandTransition("outbound", "sending", "accepted"), "illegal", "cannot regress mid-flight");
});

test("terminal states have no legal outward command transition, in either direction", () => {
  for (const state of FAX_TERMINAL_STATES) {
    assert.equal(isFaxTerminalState(state), true);
    for (const direction of ["outbound", "inbound"] as FaxDirection[]) {
      for (const candidate of ["draft", "prepared", "submitting", "accepted", "sending", "receiving", "processing"] as FaxState[]) {
        const outcome = classifyFaxCommandTransition(direction, state, candidate);
        assert.ok(outcome === "illegal" || outcome === "duplicate", `${direction} ${state} -> ${candidate} must not apply`);
      }
    }
  }
  assert.equal(isFaxTerminalState("submitting"), false);
  assert.equal(isFaxTerminalState("ambiguous"), false);
});

// --- Provider observation reconciliation (out-of-order/duplicate-safe) -----

test("a provider observation can safely advance over a missing intermediate stage", () => {
  assert.equal(reconcileFaxObservation("outbound", "accepted", "sending"), "advanced");
  // "delivered" observed directly on an "accepted" fax must still converge,
  // even though accepted -> delivered is not a single command edge.
  assert.equal(reconcileFaxObservation("outbound", "accepted", "delivered"), "advanced");
});

test("delivered arriving before sending still converges to delivered", () => {
  assert.equal(reconcileFaxObservation("outbound", "submitting", "delivered"), "advanced");
});

test("received arriving before processing still converges to received", () => {
  assert.equal(reconcileFaxObservation("inbound", "receiving", "received"), "advanced");
});

test("late accepted after sending does not regress", () => {
  assert.equal(reconcileFaxObservation("outbound", "sending", "accepted"), "stale");
});

test("late processing after received does not regress", () => {
  assert.equal(reconcileFaxObservation("inbound", "received", "processing"), "stale");
});

test("duplicate provider observations are idempotent", () => {
  assert.equal(reconcileFaxObservation("outbound", "sending", "sending"), "duplicate");
  assert.equal(reconcileFaxObservation("outbound", "delivered", "delivered"), "duplicate");
  assert.equal(reconcileFaxObservation("inbound", "received", "received"), "duplicate");
});

test("cancel_pending race converges to an authoritative provider outcome", () => {
  assert.equal(reconcileFaxObservation("outbound", "cancel_pending", "delivered"), "advanced");
  assert.equal(reconcileFaxObservation("outbound", "cancel_pending", "failed"), "advanced");
  assert.equal(reconcileFaxObservation("outbound", "cancel_pending", "cancelled"), "advanced");
});

test("ambiguous reconciles from a later authoritative observation without every intermediate webhook", () => {
  assert.equal(reconcileFaxObservation("outbound", "ambiguous", "accepted"), "advanced");
  assert.equal(reconcileFaxObservation("outbound", "ambiguous", "sending"), "advanced");
  assert.equal(reconcileFaxObservation("outbound", "ambiguous", "delivered"), "advanced");
  assert.equal(reconcileFaxObservation("outbound", "ambiguous", "failed"), "advanced");
  assert.equal(reconcileFaxObservation("outbound", "ambiguous", "cancelled"), "advanced");
});

test("provider observations never regress out of a terminal state", () => {
  for (const state of FAX_TERMINAL_STATES) {
    for (const direction of ["outbound", "inbound"] as FaxDirection[]) {
      for (const candidate of ["draft", "prepared", "submitting", "accepted", "sending", "receiving", "processing"] as FaxState[]) {
        const outcome = reconcileFaxObservation(direction, state, candidate);
        assert.ok(outcome === "stale" || outcome === "illegal", `${direction} ${state} observing ${candidate} must not advance`);
      }
    }
  }
});

test("reconciliation is direction-scoped: cross-direction observations are illegal, not merely stale", () => {
  assert.equal(reconcileFaxObservation("outbound", "accepted", "receiving"), "illegal");
  assert.equal(reconcileFaxObservation("outbound", "accepted", "processing"), "illegal");
  assert.equal(reconcileFaxObservation("inbound", "receiving", "accepted"), "illegal");
  assert.equal(reconcileFaxObservation("inbound", "receiving", "draft"), "illegal");
});

// --- Contract hygiene: no Telnyx-specific fields in the neutral domain -----

test("FaxRequest carries no Telnyx-specific clientState field", () => {
  const request: FaxRequest = {
    localFaxId: "fax-contract-check",
    to: "+15557654321",
    documentRef: { id: "doc-1" },
    correlation: "safe-neutral-correlation-value"
  };
  assert.equal(Object.prototype.hasOwnProperty.call(request, "clientState"), false);
  assert.deepEqual(Object.keys(request).sort(), ["correlation", "documentRef", "localFaxId", "to"].sort());
});
