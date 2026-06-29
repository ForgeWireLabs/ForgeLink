const assert = require("node:assert/strict");
const test = require("node:test");
const { runKillerDemo } = require("./scripts/killer-demo");

// OCX-016: the killer demo must run end to end on synthetic data with no telecom
// credentials, and reach a clean, audited, replayable outcome.
test("runs the killer demo lifecycle to an audited approved+published outcome", async () => {
  const result = await runKillerDemo({ log: () => {} });
  assert.equal(result.decided, true);
  assert.equal(result.audit_ok, true);
  assert.equal(result.final_state, "action_succeeded");
  assert.ok(result.steps >= 6, "replay should include the full lifecycle");
});
