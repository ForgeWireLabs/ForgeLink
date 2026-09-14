const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const tauriRoot = path.join(root, "Tauri");
const rustRoot = path.join(tauriRoot, "src-tauri", "src");
const rustLib = fs.readFileSync(path.join(rustRoot, "lib.rs"), "utf8");
const navigation = fs.readFileSync(path.join(rustRoot, "navigation.rs"), "utf8");
const notifications = fs.readFileSync(path.join(rustRoot, "notifications.rs"), "utf8");
const desktopIntegration = fs.readFileSync(path.join(rustRoot, "desktop_integration.rs"), "utf8");
const shell = fs.readFileSync(path.join(root, "Electron", "renderer", "src", "shell.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "Electron", "renderer", "src", "App.tsx"), "utf8");
const main = fs.readFileSync(path.join(root, "Electron", "main.js"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(tauriRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const capability = JSON.parse(fs.readFileSync(path.join(tauriRoot, "src-tauri", "capabilities", "default.json"), "utf8"));
const cargo = fs.readFileSync(path.join(tauriRoot, "src-tauri", "Cargo.toml"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "Electron", "package.json"), "utf8"));

test("Tauri registers native integration plugins in the required order", () => {
  const singleInstance = rustLib.indexOf("tauri_plugin_single_instance::init");
  const deepLink = rustLib.indexOf("tauri_plugin_deep_link::init");
  const notification = rustLib.indexOf("tauri_plugin_notification::init");
  const opener = rustLib.indexOf("tauri_plugin_opener::init");
  const windowState = rustLib.indexOf("tauri_plugin_window_state::Builder");
  assert.ok(singleInstance >= 0 && singleInstance < deepLink, "single-instance must be registered before deep-link");
  assert.ok(deepLink < notification && notification < opener && opener < windowState);
  assert.match(cargo, /tauri-plugin-single-instance\s*=.*features\s*=\s*\["deep-link"\]/s);
  assert.match(cargo, /tauri-plugin-deep-link\s*=/);
  assert.match(cargo, /tauri-plugin-notification\s*=/);
  assert.match(cargo, /tauri-plugin-opener\s*=/);
  assert.match(cargo, /tauri-plugin-window-state\s*=/);
});

test("deep links are statically registered for desktop and mobile and cross only the event bridge", () => {
  assert.deepEqual(config.plugins["deep-link"].desktop.schemes, ["forgelink"]);
  assert.deepEqual(config.plugins["deep-link"].mobile, [{ scheme: ["forgelink"], appLink: false }]);
  assert.ok(capability.permissions.includes("core:event:default"));
  assert.match(navigation, /forgelink:\/\/open\//);
  assert.match(navigation, /MAX_DEEP_LINK_BYTES/);
  assert.match(navigation, /MAX_LOCAL_ID_BYTES/);
  assert.match(navigation, /contains\(\['\?', '#', '\\\\', '%', ':'\]\)/);
  assert.match(rustLib, /forgelink_take_navigation_intent/);
  assert.match(shell, /forgelink:\/\/navigation-intent/);
  assert.match(shell, /forgelink_take_navigation_intent/);
  assert.match(app, /localStorage\.setItem\("forgelink\.navigation\.surface"/);
  assert.match(app, /onNavigationIntent\(applyNavigationIntent\)/);
});

test("native notifications keep attention policy, redaction, permission, and activation boundaries", () => {
  assert.match(notifications, /evaluate_attention/);
  assert.match(notifications, /permission_state\(\)/);
  assert.match(notifications, /request_permission\(\)/);
  assert.match(notifications, /mark_permission_requested/);
  assert.match(notifications, /extra\("navigation"/);
  assert.match(rustLib, /plugin:notification\|actionPerformed/);
  assert.match(rustLib, /intent_from_notification/);
  assert.match(rustLib, /activate_main_window/);
});

test("external navigation is credential-free HTTPS only in both shells", () => {
  assert.match(desktopIntegration, /url\.scheme\(\) != "https"/);
  assert.match(desktopIntegration, /url\.password\(\)\.is_some\(\)/);
  assert.match(main, /isCredentialFreeHttpsUrl/);
  assert.match(main, /url\.protocol === "https:"/);
  assert.match(main, /!url\.username && !url\.password/);
});

test("Electron compatibility remains available with a safe no-op navigation subscription", () => {
  assert.ok(fs.existsSync(path.join(root, "Electron", "main.js")));
  assert.match(fs.readFileSync(path.join(root, "Electron", "preload.js"), "utf8"), /onNavigationIntent: \(\) => \(\) => undefined/);
  assert.match(shell, /onNavigationIntent: \(\) => \(\) => undefined/);
  assert.match(packageJson.scripts.test, /tauri-desktop-integration\.test\.js/);
});
