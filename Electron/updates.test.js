const assert = require("node:assert/strict");
const test = require("node:test");
const { shouldAutoUpdate } = require("./updates");

test("auto-update only runs in a packaged build unless disabled", () => {
  assert.equal(shouldAutoUpdate({ isPackaged: false, env: {} }), false);
  assert.equal(shouldAutoUpdate({ isPackaged: true, env: {} }), true);
  assert.equal(shouldAutoUpdate({ isPackaged: true, env: { FORGELINK_DISABLE_UPDATES: "1" } }), false);
  assert.equal(shouldAutoUpdate({}), false);
});
