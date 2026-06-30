const assert = require("node:assert/strict");
const test = require("node:test");
const { createEmailSettingsStore } = require("./emailSettings");

// In-memory fs + reversible "encryption" so the secure-storage logic is testable
// without Electron. encryptString/decryptString stand in for OS-backed safeStorage.
function makeEnv() {
  const files = new Map();
  const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  const fs = {
    readFileSync(p) { if (!files.has(p)) throw enoent(); return files.get(p); },
    writeFileSync(p, data) { files.set(p, data); },
    mkdirSync() { /* noop */ },
    unlinkSync(p) { if (!files.has(p)) throw enoent(); files.delete(p); }
  };
  const path = { join: (...a) => a.join("/"), dirname: (p) => p.split("/").slice(0, -1).join("/") };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (buf) => buf.toString("utf8").replace(/^enc:/, "")
  };
  return { fs, path, safeStorage, userData: "/data", files };
}

test("EMAIL-002: stores SMTP credentials encrypted and redacts them from the view", () => {
  const env = makeEnv();
  const store = createEmailSettingsStore(env);
  const saved = store.persist({ host: "smtp.example.com", port: 587, user: "ops@example.com", pass: "secret-pass", from: "ForgeLink <ops@example.com>", inbound_secret: "in-sec", action_secret: "act-sec" });
  assert.equal(saved.configured, true);
  assert.equal(saved.password_present, true);
  assert.equal(saved.inbound_secret_present, true);
  assert.equal(saved.action_secret_present, true);
  // The redacted view never contains the secret values.
  const view = JSON.stringify(saved);
  assert.doesNotMatch(view, /secret-pass/);
  assert.doesNotMatch(view, /in-sec|act-sec/);
  // The persisted file stores only encrypted secrets, never plaintext.
  const raw = env.files.get("/data/email-settings.json");
  assert.doesNotMatch(raw, /"secret-pass"/);
  assert.match(raw, /smtp_pass_encrypted/);
  // backendEnv hands the decrypted values to the backend launch only.
  const backendEnv = store.backendEnv();
  assert.equal(backendEnv.FORGELINK_SMTP_PASS, "secret-pass");
  assert.equal(backendEnv.FORGELINK_SMTP_SECURE, "0"); // port 587 -> STARTTLS
  assert.equal(backendEnv.FORGELINK_EMAIL_INBOUND_SECRET, "in-sec");
  assert.equal(backendEnv.FORGELINK_EMAIL_ACTION_SECRET, "act-sec");
});

test("EMAIL-002: reloads from disk, keeps the password on blank re-save, and removes cleanly", () => {
  const env = makeEnv();
  createEmailSettingsStore(env).persist({ host: "smtp.example.com", port: 465, user: "ops@example.com", pass: "secret-pass", from: "ops@example.com" });
  const store = createEmailSettingsStore(env);
  assert.equal(store.load().configured, true);
  assert.equal(store.backendEnv().FORGELINK_SMTP_PASS, "secret-pass");
  // Re-saving config without a new password keeps the existing encrypted one.
  store.persist({ host: "smtp2.example.com", user: "ops@example.com", from: "ops@example.com" });
  assert.equal(store.backendEnv().FORGELINK_SMTP_PASS, "secret-pass");
  assert.equal(store.backendEnv().FORGELINK_SMTP_HOST, "smtp2.example.com");
  // Remove clears credentials and the backend env.
  assert.equal(store.remove().configured, false);
  assert.deepEqual(store.backendEnv(), {});
});

test("EMAIL-002: requires host, user, and a password", () => {
  const store = createEmailSettingsStore(makeEnv());
  assert.throws(() => store.persist({ host: "", user: "x", pass: "p" }), /SMTP host/);
  assert.throws(() => store.persist({ host: "h", user: "u" }), /password/);
});
