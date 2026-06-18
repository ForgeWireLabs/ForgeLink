// Auto-update decision helper (PR-014). Pure and unit-tested; the actual
// electron-updater call in main.js is guarded by this so updates only run in a
// real installed build and can be disabled by the operator.

function shouldAutoUpdate({ isPackaged, env = {} } = {}) {
  if (!isPackaged) return false;                 // never in dev / tests
  if (env.FORGELINK_DISABLE_UPDATES === "1") return false; // operator opt-out
  return true;
}

module.exports = { shouldAutoUpdate };
