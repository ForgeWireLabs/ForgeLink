const assert = require("node:assert/strict");
const test = require("node:test");
const { createPushSettingsStore } = require("./pushSettings");

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

test("PUSH-003: stores the topic and token encrypted and redacts them from the view", () => {
  const env = makeEnv();
  const store = createPushSettingsStore(env);
  const saved = store.persist({ url: "https://push.example.com", topic: "secret-topic-9f3", token: "tk_live_abc", profile: "full" });
  assert.equal(saved.configured, true);
  assert.equal(saved.topic_present, true);
  assert.equal(saved.token_present, true);
  assert.equal(saved.profile, "full");
  // The redacted view never contains the topic or token.
  const view = JSON.stringify(saved);
  assert.doesNotMatch(view, /secret-topic-9f3/);
  assert.doesNotMatch(view, /tk_live_abc/);
  // The persisted file stores only encrypted secrets, never plaintext.
  const raw = env.files.get("/data/push-settings.json");
  assert.doesNotMatch(raw, /"secret-topic-9f3"/);
  assert.doesNotMatch(raw, /tk_live_abc(?!.*enc:)/);
  assert.match(raw, /topic_encrypted/);
  assert.match(raw, /token_encrypted/);
  // backendEnv hands the decrypted values to the backend launch only.
  const backendEnv = store.backendEnv();
  assert.equal(backendEnv.FORGELINK_PUSH_TOPIC, "secret-topic-9f3");
  assert.equal(backendEnv.FORGELINK_PUSH_TOKEN, "tk_live_abc");
  assert.equal(backendEnv.FORGELINK_PUSH_PROFILE, "full");
});

test("PUSH-003: reloads from disk, keeps the topic/token on blank re-save (rotation), and revokes cleanly", () => {
  const env = makeEnv();
  createPushSettingsStore(env).persist({ url: "https://push.example.com", topic: "topic-1", token: "tok-1" });
  const store = createPushSettingsStore(env);
  assert.equal(store.load().configured, true);
  assert.equal(store.backendEnv().FORGELINK_PUSH_TOPIC, "topic-1");
  // Re-saving config (e.g. switching to full) without a new topic keeps the stored one.
  store.persist({ url: "https://push.example.com", profile: "full" });
  assert.equal(store.backendEnv().FORGELINK_PUSH_TOPIC, "topic-1");
  assert.equal(store.backendEnv().FORGELINK_PUSH_PROFILE, "full");
  // Rotation: a new topic replaces the old one.
  store.persist({ url: "https://push.example.com", topic: "topic-2" });
  assert.equal(store.backendEnv().FORGELINK_PUSH_TOPIC, "topic-2");
  // Revoke: remove clears credentials and the backend env so the channel goes disabled.
  assert.equal(store.remove().configured, false);
  assert.deepEqual(store.backendEnv(), {});
});

test("PUSH-003: requires a URL and a topic, and defaults to the safe profile", () => {
  const store = createPushSettingsStore(makeEnv());
  assert.throws(() => store.persist({ url: "", topic: "t" }), /URL/);
  assert.throws(() => store.persist({ url: "https://push.example.com" }), /topic/);
  const saved = store.persist({ url: "https://push.example.com", topic: "t" });
  assert.equal(saved.profile, "lock_screen_safe");
  assert.equal(saved.token_present, false);
});
