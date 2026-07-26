const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const tauriRoot = path.join(root, "Tauri");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(tauriRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const mobileCapability = JSON.parse(fs.readFileSync(path.join(tauriRoot, "src-tauri", "capabilities", "mobile-cockpit.json"), "utf8"));
const tauriMain = fs.readFileSync(path.join(tauriRoot, "src-tauri", "src", "lib.rs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

test("Tauri desktop scaffold reuses the shared renderer beside Electron", () => {
  assert.equal(tauriConfig.build.frontendDist, "../../Electron/renderer");
  assert.equal(tauriConfig.app.withGlobalTauri, true);
  assert.ok(fs.existsSync(path.join(root, "Electron", "main.js")), "Electron must remain until the retirement gate is satisfied");
  assert.match(packageJson.scripts.test, /tauri-scaffold\.test\.js/);
});

test("Tauri command scaffold covers the current ForgeLink shell bridge groups", () => {
  for (const command of [
    "forgelink_backend_connection",
    "forgelink_get_status",
    "forgelink_start_local_only",
    "forgelink_start_service",
    "forgelink_notify_event",
    "forgelink_open_external",
    "forgelink_attention_policy",
    "forgelink_mcp_status",
    "forgelink_agent_channels",
    "forgelink_email_settings",
    "forgelink_push_settings"
  ]) {
    assert.match(tauriMain, new RegExp(`fn ${command}\\b`), `${command} command is missing`);
    assert.match(tauriMain, new RegExp(`${command},`), `${command} is not registered in invoke_handler`);
  }
});

test("Tauri mobile capability keeps the cockpit full while decision terminal remains restricted", () => {
  assert.equal(mobileCapability.context.shared_cockpit, true);
  assert.equal(mobileCapability.context.restricted_decision_terminal_profile, "mobile_lock_screen");
  assert.equal(mobileCapability.context.private_database_replication, false);
  assert.deepEqual(mobileCapability.context.allowed_decision_actions, ["approve", "deny", "defer", "request_more_info", "short_reply"]);
  assert.ok(mobileCapability.context.operator_controls.includes("device_revoke"));
});
