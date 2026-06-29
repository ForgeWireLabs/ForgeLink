const assert = require("node:assert/strict");
const test = require("node:test");
const { runReleasePreflight } = require("./scripts/release-preflight");

// PR-014: the non-signing release verifications must pass on the committed tree, so
// a release can be cut reproducibly without surprises before the cert-gated steps.
test("release preflight passes the non-signing checks", () => {
  const result = runReleasePreflight();
  const failed = result.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  assert.equal(result.ok, true, `release preflight failed: ${failed.join("; ")}`);
  // Spot-check that the core gates are actually exercised.
  for (const name of ["version sync", "electron-updater dependency", "publish provider", "backend asarUnpack", "icon assets exist", "auto-update guard"]) {
    assert.ok(result.checks.some((check) => check.name === name), `missing preflight check: ${name}`);
  }
});
