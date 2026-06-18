const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { scanText, scanFiles } = require("./security");

// Built by concatenation so this test file does not itself contain a literal secret.
const FAKE_KEY = "-----BEGIN " + "PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----";
const FAKE_AWS = "AKIA" + "ABCDEFGHIJKLMNOP";

test("scanText flags common secret patterns", () => {
  assert.ok(scanText("a.js", FAKE_KEY).some((f) => f.rule === "private-key"));
  assert.ok(scanText("a.js", "const k = '" + FAKE_AWS + "';").some((f) => f.rule === "aws-access-key"));
  assert.ok(scanText("a.env", "TWILIO_AUTH_TOKEN=" + "0".repeat(32)).some((f) => f.rule === "twilio-auth-token"));
  assert.ok(scanText("a.js", "const client_secret = '" + "x".repeat(30) + "';").some((f) => f.rule === "generic-secret-assignment"));
});

test("scanText ignores clean source", () => {
  assert.deepEqual(scanText("a.js", "const port = 5055;\nconst token = randomBytes(32);"), []);
});

test("scanFiles detects a planted secret and skips excluded paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-scan-"));
  try {
    fs.writeFileSync(path.join(dir, "leak.js"), "const k = '" + FAKE_AWS + "';\n");
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "dep.js"), "const k = '" + FAKE_AWS + "';\n");
    fs.writeFileSync(path.join(dir, "thing.test.js"), "const k = '" + FAKE_AWS + "';\n");
    const findings = scanFiles(dir, ["leak.js", "node_modules/dep.js", "thing.test.js"]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, "leak.js");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
