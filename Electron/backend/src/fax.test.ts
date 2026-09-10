import assert from "node:assert/strict";
import test from "node:test";
import { classifyFaxTransition, FAX_TERMINAL_STATES, FaxState, isFaxTerminalState } from "./fax";

test("legal outbound transitions are applied in order", () => {
  const path: FaxState[] = ["draft", "prepared", "submission_pending", "submitting", "accepted", "sending", "delivered"];
  for (let i = 1; i < path.length; i++) {
    assert.equal(classifyFaxTransition(path[i - 1], path[i]), "applied", `${path[i - 1]} -> ${path[i]}`);
  }
});

test("legal inbound transitions are applied in order", () => {
  const path: FaxState[] = ["receiving", "processing", "received"];
  for (let i = 1; i < path.length; i++) {
    assert.equal(classifyFaxTransition(path[i - 1], path[i]), "applied", `${path[i - 1]} -> ${path[i]}`);
  }
});

test("a network failure after submission goes to ambiguous, not failed, and ambiguous resolves", () => {
  assert.equal(classifyFaxTransition("submitting", "ambiguous"), "applied");
  assert.equal(classifyFaxTransition("ambiguous", "accepted"), "applied");
  assert.equal(classifyFaxTransition("ambiguous", "failed"), "applied");
  assert.equal(classifyFaxTransition("ambiguous", "cancelled"), "applied");
});

test("cancellation races: cancel_pending can still resolve to delivered or failed", () => {
  assert.equal(classifyFaxTransition("accepted", "cancel_pending"), "applied");
  assert.equal(classifyFaxTransition("sending", "cancel_pending"), "applied");
  assert.equal(classifyFaxTransition("cancel_pending", "cancelled"), "applied");
  assert.equal(classifyFaxTransition("cancel_pending", "delivered"), "applied");
  assert.equal(classifyFaxTransition("cancel_pending", "failed"), "applied");
});

test("duplicate transitions (same state twice) are idempotent, not errors", () => {
  assert.equal(classifyFaxTransition("submitting", "submitting"), "duplicate");
  assert.equal(classifyFaxTransition("delivered", "delivered"), "duplicate");
  assert.equal(classifyFaxTransition("draft", "draft"), "duplicate");
});

test("regressive and skip-ahead transitions are rejected as illegal", () => {
  assert.equal(classifyFaxTransition("delivered", "sending"), "illegal", "cannot regress from a terminal state");
  assert.equal(classifyFaxTransition("sending", "accepted"), "illegal", "cannot regress mid-flight");
  assert.equal(classifyFaxTransition("draft", "delivered"), "illegal", "cannot skip the whole lifecycle");
  assert.equal(classifyFaxTransition("prepared", "accepted"), "illegal", "cannot skip submission");
  assert.equal(classifyFaxTransition("receiving", "received"), "illegal", "cannot skip inbound processing");
});

test("terminal states have no legal outward transition", () => {
  for (const state of FAX_TERMINAL_STATES) {
    assert.equal(isFaxTerminalState(state), true);
    for (const candidate of ["draft", "prepared", "submitting", "accepted", "sending", "receiving", "processing"] as FaxState[]) {
      assert.equal(classifyFaxTransition(state, candidate), "illegal", `${state} -> ${candidate} must be illegal`);
    }
  }
  assert.equal(isFaxTerminalState("submitting"), false);
  assert.equal(isFaxTerminalState("ambiguous"), false);
});

test("outbound and inbound lifecycles do not cross-contaminate", () => {
  assert.equal(classifyFaxTransition("draft", "receiving"), "illegal");
  assert.equal(classifyFaxTransition("receiving", "prepared"), "illegal");
  assert.equal(classifyFaxTransition("accepted", "processing"), "illegal");
});
