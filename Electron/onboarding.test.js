const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSettingsStore, validateTwilioCredentials, configureNumberWebhook } = require("./onboarding");
const { DEFAULT_ATTENTION_POLICY } = require("./attention");

const complete = { account_sid: `AC${"a".repeat(32)}`, auth_token: "secret-token", twilio_number: "+15551234567", public_base_url: "https://phone.example.com", webhook_host: "127.0.0.1", webhook_port: 5055 };
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: value => value.toString().replace("encrypted:", "") };

test("encrypts, redacts, reloads, and removes stored credentials", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "twilio-phone-settings-"));
  try {
    const store = createSettingsStore({ fs, path, safeStorage, env: {}, userData: directory });
    store.load(); store.persist(complete);
    const raw = readFileSync(path.join(directory, "settings.json"), "utf8");
    assert.equal(raw.includes("secret-token"), false);
    const reloaded = createSettingsStore({ fs, path, safeStorage, env: {}, userData: directory });
    assert.equal(reloaded.load().settings.auth_token, "secret-token");
    assert.equal(reloaded.removeCredentials().configured, false);
    assert.equal(fs.existsSync(path.join(directory, "settings.json")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("loads and removes credentials from the previous app settings path", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "forgelink-settings-"));
  const current = path.join(directory, "ForgeLink");
  const legacy = path.join(directory, "Twilio Phone");
  try {
    fs.mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "settings.json"), JSON.stringify({ ...complete, auth_token: undefined, auth_token_encrypted: safeStorage.encryptString(complete.auth_token).toString("base64") }));
    const store = createSettingsStore({ fs, path, safeStorage, env: {}, userData: current, legacyUserData: legacy });
    assert.equal(store.load().settings.auth_token, "secret-token");
    assert.equal(store.removeCredentials().configured, false);
    assert.equal(fs.existsSync(path.join(legacy, "settings.json")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("imports environment credentials only through an explicit action", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "twilio-phone-env-"));
  try {
    const env = { TWILIO_ACCOUNT_SID: complete.account_sid, TWILIO_AUTH_TOKEN: complete.auth_token, TWILIO_PHONE_NUMBER: complete.twilio_number, TWILIO_PUBLIC_BASE_URL: complete.public_base_url };
    const store = createSettingsStore({ fs, path, safeStorage, env, userData: directory });
    const loaded = store.load();
    assert.equal(loaded.source, "environment");
    assert.equal(fs.existsSync(path.join(directory, "settings.json")), false);
    assert.equal(store.importEnvironment().source, "stored");
    assert.equal(fs.existsSync(path.join(directory, "settings.json")), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("persists attention policy without exposing credentials", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "forgelink-attention-"));
  try {
    const store = createSettingsStore({ fs, path, safeStorage, env: {}, userData: directory });
    store.load();
    const saved = store.persistAttentionPolicy({ ...DEFAULT_ATTENTION_POLICY, signal_notifications: "all", muted_sources: ["forgewire"] });
    assert.equal(saved.settings.attention_policy.signal_notifications, "all");
    assert.deepEqual(saved.settings.attention_policy.muted_sources, ["forgewire"]);
    const raw = readFileSync(path.join(directory, "settings.json"), "utf8");
    assert.equal(raw.includes("secret-token"), false);
    const reloaded = createSettingsStore({ fs, path, safeStorage, env: {}, userData: directory });
    assert.equal(reloaded.load().settings.attention_policy.signal_notifications, "all");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("validates credentials and confirms the selected Twilio number", async () => {
  const calls = [];
  const result = await validateTwilioCredentials(complete, async url => {
    calls.push(url);
    return url.includes("IncomingPhoneNumbers")
      ? { ok: true, json: async () => ({ incoming_phone_numbers: [{ phone_number: complete.twilio_number }] }) }
      : { ok: true, json: async () => ({ friendly_name: "Test Account", status: "active" }) };
  });
  assert.equal(result.account_name, "Test Account");
  assert.equal(result.phone_number, complete.twilio_number);
  assert.equal(calls.length, 2);
  await assert.rejects(() => validateTwilioCredentials(complete, async () => ({ ok: false, status: 401, json: async () => ({}) })), /rejected/);
});

test("configures the Twilio number SMS webhook to the tunnel URL", async () => {
  const calls = [];
  const result = await configureNumberWebhook({ ...complete, public_base_url: "" }, "https://swift-bird-42.trycloudflare.com/", async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (url.includes("IncomingPhoneNumbers.json")) {
      return { ok: true, json: async () => ({ incoming_phone_numbers: [{ phone_number: complete.twilio_number, sid: "PN0001" }] }) };
    }
    return { ok: true, json: async () => ({ sid: "PN0001" }) };
  });
  assert.equal(result.sms_url, "https://swift-bird-42.trycloudflare.com/webhooks/sms");
  const update = calls.find(call => call.method === "POST");
  assert.ok(update, "expected a POST to update the number");
  assert.ok(update.url.endsWith("/IncomingPhoneNumbers/PN0001.json"));
  assert.ok(decodeURIComponent(update.body).includes("SmsUrl=https://swift-bird-42.trycloudflare.com/webhooks/sms"));
  await assert.rejects(() => configureNumberWebhook({ ...complete, public_base_url: "" }, "http://insecure.example"), /HTTPS/);
});
