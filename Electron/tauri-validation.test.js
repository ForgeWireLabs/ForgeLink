const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const evidence = JSON.parse(fs.readFileSync(path.join(root, "Tauri", "validation-rollback-evidence.json"), "utf8"));
const validationDoc = fs.readFileSync(path.join(root, "docs", "tauri-validation-rollback-evidence.md"), "utf8");
const appTest = fs.readFileSync(path.join(__dirname, "renderer", "src", "App.test.tsx"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

test("TAURI-007 validation matrix covers bridge, desktop shell, mobile flow, and rollback", () => {
  assert.equal(evidence.criterion, "TAURI-007");
  for (const area of ["shared_shell_bridge", "tauri_desktop_shell", "mobile_decision_flow", "distribution_update_guards", "rollback"]) {
    assert.ok(evidence.validation[area], `missing validation area: ${area}`);
    assert.equal(evidence.validation[area].status, "covered", `${area} is not covered`);
  }
  assert.equal(evidence.limitations.mobile_emulator_or_device_smoke.status, "covered");
  assert.match(evidence.limitations.mobile_emulator_or_device_smoke.reason, /live Android emulator smoke/);
  assert.equal(evidence.limitations.packaged_tauri_mobile_app_smoke.status, "not_claimed");
});

test("TAURI-007 evidence references executable checks that are present in the repo", () => {
  for (const command of [
    "npx vitest run renderer/src/App.test.tsx",
    "node --test tauri-scaffold.test.js",
    "node --test tauri-distribution.test.js",
    "node --test tauri-validation.test.js",
    "cargo test --manifest-path Tauri/src-tauri/Cargo.toml",
    "cargo check --manifest-path Tauri/src-tauri/Cargo.toml",
    "python .local/validate_system.py"
  ]) {
    assert.ok(evidence.commands.includes(command), `missing command: ${command}`);
  }
  assert.match(appTest, /routes shell calls through Tauri invoke/);
  assert.match(appTest, /surfaces the Tauri mobile decision terminal flow without private database replication/);
  assert.match(packageJson.scripts.test, /tauri-validation\.test\.js/);
});

test("rollback evidence documents preserving Electron and data safety", () => {
  assert.match(validationDoc, /Electron remains the supported compatibility shell/);
  assert.match(validationDoc, /managed backups/);
  assert.match(validationDoc, /Do not remove Electron/);
  assert.equal(evidence.rollback.electron_compatibility_shell_retained, true);
  assert.equal(evidence.rollback.no_schema_or_private_data_migration, true);
  assert.equal(evidence.rollback.mobile_store_or_emulator_artifacts_required_before_public_ship, true);
});
