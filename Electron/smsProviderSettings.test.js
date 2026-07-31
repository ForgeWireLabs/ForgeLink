const assert = require("node:assert/strict");
const test = require("node:test");
const { createSmsProviderSettingsStore, validateTelnyxSettings, configureTelnyxWebhook } = require("./smsProviderSettings");

const PROFILE = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PUBLIC_KEY = Buffer.alloc(32, 7).toString("base64");

function makeEnv(processEnv = {}) {
  const files = new Map();
  const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  const fs = {
    readFileSync(p) { if (!files.has(p)) throw enoent(); return files.get(p); },
    writeFileSync(p, data) { files.set(p, data); }, mkdirSync() {},
    unlinkSync(p) { if (!files.has(p)) throw enoent(); files.delete(p); }
  };
  const path = { join: (...parts) => parts.join("/"), dirname: p => p.split("/").slice(0, -1).join("/") };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => value.toString().replace(/^encrypted:/, "")
  };
  return { fs, path, safeStorage, env: processEnv, userData: "/data", files };
}

function settings(overrides = {}) {
  return { api_key: "KEY-secret", phone_number: "+15551234567", public_key: PUBLIC_KEY, messaging_profile_id: PROFILE, ...overrides };
}

test("TEL-002: encrypts Telnyx secrets, redacts the renderer view, selects it, and removes it", () => {
  const fixture = makeEnv();
  const store = createSmsProviderSettingsStore(fixture);
  store.load();
  const saved = store.persist({ ...settings(), preferred_provider: "telnyx" });
  assert.equal(saved.preferred_provider, "telnyx");
  assert.equal(saved.telnyx.configured, true);
  assert.equal(saved.telnyx.inbound_configured, true);
  assert.doesNotMatch(JSON.stringify(saved), /KEY-secret/);
  assert.doesNotMatch(JSON.stringify(saved), new RegExp(PUBLIC_KEY.replace(/[+/=]/g, "\\$&")));
  const raw = fixture.files.get("/data/sms-provider-settings.json");
  assert.doesNotMatch(raw, /"KEY-secret"/);
  assert.match(raw, /telnyx_api_key_encrypted/);
  assert.equal(store.backendEnv().TELNYX_API_KEY, "KEY-secret");
  assert.equal(store.backendEnv().FORGELINK_SMS_PROVIDER, "telnyx");
  assert.equal(store.removeTelnyx().telnyx.configured, false);
  assert.equal(store.current().preferred_provider, "none");
});

test("PNC-001: local-only is the default and configured providers require explicit selection", () => {
  const localStore = createSmsProviderSettingsStore(makeEnv());
  assert.equal(localStore.load().preferred_provider, "none");
  assert.equal(localStore.backendEnv().FORGELINK_SMS_PROVIDER, "none");
  assert.throws(() => localStore.select("twilio"), /Configure Twilio/);

  const fixture = makeEnv();
  const twilioStore = createSmsProviderSettingsStore({ ...fixture, twilioConfigured: () => true });
  assert.equal(twilioStore.load().preferred_provider, "twilio");
  assert.equal(twilioStore.select("none").preferred_provider, "none");
  const restarted = createSmsProviderSettingsStore({ ...fixture, twilioConfigured: () => true });
  assert.equal(restarted.load().preferred_provider, "none");
  assert.equal(twilioStore.select("twilio").preferred_provider, "twilio");
});

test("PNC-004: removing selected Telnyx falls back only to a configured Twilio edge", () => {
  const fixture = makeEnv();
  const store = createSmsProviderSettingsStore({ ...fixture, twilioConfigured: () => true });
  store.load();
  store.persist({ ...settings(), preferred_provider: "telnyx" });
  assert.equal(store.removeTelnyx().preferred_provider, "twilio");

  const localFixture = makeEnv();
  const localStore = createSmsProviderSettingsStore({ ...localFixture, twilioConfigured: () => true });
  localStore.load();
  localStore.persist({ ...settings(), preferred_provider: "none" });
  assert.equal(localStore.removeTelnyx().preferred_provider, "none");
});

test("TEL-002: environment fallback remains available without persisting plaintext", () => {
  const fixture = makeEnv({ TELNYX_API_KEY: "KEY-env", TELNYX_PHONE_NUMBER: "+15551234567", TELNYX_PUBLIC_KEY: PUBLIC_KEY, TELNYX_MESSAGING_PROFILE_ID: PROFILE, FORGELINK_SMS_PROVIDER: "telnyx" });
  const store = createSmsProviderSettingsStore(fixture);
  const current = store.load();
  assert.equal(current.telnyx.source, "environment");
  assert.equal(current.preferred_provider, "telnyx");
  assert.equal(current.telnyx.api_key_present, true);
  assert.equal(fixture.files.size, 0);
});

test("TEL-003: validates the Telnyx number/profile relationship without mutating it", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("messaging_phone_numbers")) return { ok: true, status: 200, json: async () => ({ data: { phone_number: "+15551234567", messaging_profile_id: PROFILE, features: { sms: { domestic_two_way: true } } } }) };
    return { ok: true, status: 200, json: async () => ({ data: { id: PROFILE, name: "ForgeLink", enabled: true, webhook_url: "" } }) };
  };
  const result = await validateTelnyxSettings(settings(), fetchImpl);
  assert.equal(result.provider, "telnyx");
  assert.equal(result.messaging_profile_name, "ForgeLink");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.init.method === "GET"));
  assert.ok(calls.every(call => !JSON.stringify(call).includes("KEY-secret") || call.init.headers.Authorization === "Bearer KEY-secret"));
});

test("TEL-003: rejects profile mismatch and redacts provider response bodies", async () => {
  const mismatch = async () => ({ ok: true, status: 200, json: async () => ({ data: { phone_number: "+15551234567", messaging_profile_id: "00000000-0000-4000-8000-000000000000" } }) });
  await assert.rejects(() => validateTelnyxSettings(settings(), mismatch), /not assigned/);
  const rejected = async () => ({ ok: false, status: 401, json: async () => ({ errors: [{ detail: "super-sensitive-provider-detail" }] }) });
  await assert.rejects(() => validateTelnyxSettings(settings(), rejected), error => {
    assert.match(error.message, /failed \(401\)/);
    assert.doesNotMatch(error.message, /super-sensitive/);
    return true;
  });
});

test("TEL-006: configures only the selected profile webhook with the v2 event format", async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url, init }; return { ok: true, status: 200, json: async () => ({ data: { id: PROFILE } }) }; };
  const result = await configureTelnyxWebhook(settings(), "https://public.example/", fetchImpl);
  assert.equal(result.webhook_url, "https://public.example/webhooks/telnyx");
  assert.equal(request.url, `https://api.telnyx.com/v2/messaging_profiles/${PROFILE}`);
  assert.equal(request.init.method, "PATCH");
  assert.deepEqual(JSON.parse(request.init.body), { webhook_url: "https://public.example/webhooks/telnyx", webhook_api_version: "2" });
});
