const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const plan = JSON.parse(fs.readFileSync(path.join(root, "Tauri", "distribution-plan.json"), "utf8"));
const strategyDoc = fs.readFileSync(path.join(root, "docs", "distribution-and-update-strategy.md"), "utf8");
const tauriStrategyDoc = fs.readFileSync(path.join(root, "docs", "tauri-distribution-update-strategy.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

test("Tauri distribution plan keeps unsigned builds internal and public release signed", () => {
  assert.equal(plan.criterion, "TAURI-006");
  assert.equal(plan.development.unsigned_dev_builds_allowed, true);
  assert.equal(plan.development.public_distribution_allowed, false);
  assert.ok(plan.desktop.public_release_requires.includes("operator_provided_code_signing_certificate"));
  assert.equal(plan.desktop.update_channel.must_not_publish_unsigned_feed, true);
  assert.equal(plan.desktop.update_channel.feed_status, "held_until_signing");
});

test("Tauri mobile updates are store-owned and do not replicate private data", () => {
  assert.equal(plan.mobile.update_channel.kind, "platform-store");
  assert.equal(plan.mobile.update_channel.self_hosted_native_update_feed_allowed, false);
  assert.equal(plan.mobile.update_channel.ota_content_updates_allowed, false);
  assert.equal(plan.mobile.data_boundary.private_database_replication, false);
  assert.equal(plan.mobile.data_boundary.authenticated_local_api_client, true);
  assert.equal(plan.mobile.data_boundary.restricted_decision_profile, "mobile_lock_screen");
  assert.equal(plan.mobile.data_boundary.signed_decision_envelopes_required, true);
});

test("Tauri distribution strategy is documented and wired into the full suite", () => {
  assert.match(strategyDoc, /Tauri distribution\/update contract/);
  assert.match(tauriStrategyDoc, /TAURI-006/);
  assert.match(tauriStrategyDoc, /Do not publish an unsigned Tauri update feed/);
  assert.match(packageJson.scripts.test, /tauri-distribution\.test\.js/);
});
