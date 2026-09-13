const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const tauriRoot = path.join(root, "Tauri");
const rustLifecycle = fs.readFileSync(path.join(tauriRoot, "src-tauri", "src", "local_service.rs"), "utf8");
const rustLib = fs.readFileSync(path.join(tauriRoot, "src-tauri", "src", "lib.rs"), "utf8");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(tauriRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const tauriPackage = JSON.parse(fs.readFileSync(path.join(tauriRoot, "package.json"), "utf8"));

test("Tauri owns a real authenticated desktop local-service lifecycle", () => {
  assert.match(rustLifecycle, /pub struct LocalServiceManager/);
  assert.match(rustLifecycle, /std::process::Child/);
  assert.match(rustLifecycle, /authenticated_health/);
  assert.match(rustLifecycle, /RESTART_LIMIT/);
  assert.match(rustLifecycle, /READINESS_TIMEOUT/);
  assert.match(rustLifecycle, /SHUTDOWN_TIMEOUT/);
  assert.match(rustLifecycle, /target_os = "android"/);
  assert.match(rustLifecycle, /target_os = "ios"/);
  assert.match(rustLifecycle, /ownership: "remote"/);
  assert.match(rustLib, /LocalServiceManager::new/);
  assert.match(rustLib, /\.shutdown\(\)/);
  assert.doesNotMatch(rustLifecycle, /tauri-scaffold-token/);
});

test("Tauri production packaging stages a self-contained backend runtime", () => {
  assert.equal(tauriConfig.bundle.active, true);
  assert.equal(tauriConfig.bundle.resources["../.runtime"], "forgelink-runtime");
  assert.match(tauriPackage.scripts["backend:prepare"], /prepare-backend-runtime\.mjs/);
  assert.match(tauriPackage.scripts["tauri:desktop:build"], /backend:prepare/);
  assert.match(fs.readFileSync(path.join(tauriRoot, "scripts", "prepare-backend-runtime.mjs"), "utf8"), /process\.execPath/);
  assert.match(fs.readFileSync(path.join(tauriRoot, "scripts", "prepare-backend-runtime.mjs"), "utf8"), /npmCommand/);
});

test("Tauri mobile remains remote-only and forbids private database replication", () => {
  const capability = JSON.parse(fs.readFileSync(path.join(tauriRoot, "src-tauri", "capabilities", "mobile-cockpit.json"), "utf8"));
  assert.equal(capability.context.private_database_replication, false);
  assert.match(rustLifecycle, /Mobile does not own the desktop local service/);
  assert.match(rustLifecycle, /FORGELINK_LOCAL_API_URL/);
});
