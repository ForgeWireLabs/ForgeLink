const assert = require("node:assert/strict");
const test = require("node:test");
const { createTelnyxFaxSettingsStore, validateTelnyxFaxSettings } = require("./telnyxFaxSettings");

// In-memory fs + reversible "encryption" so secure-storage logic is testable
// without Electron. Mirrors emailSettings.test.js / smsProviderSettings.test.js.
function makeEnv(envOverrides = {}) {
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
  return { fs, path, safeStorage, env: envOverrides, userData: "/data", files };
}

const SYNTHETIC_PUBLIC_KEY = Buffer.alloc(32, 7).toString("base64");

test("TFX-001: persists Telnyx Fax settings encrypted, redacts them from the view, and separates them from SMS/MMS Telnyx config", () => {
  const env = makeEnv();
  const store = createTelnyxFaxSettingsStore(env);
  const saved = store.persist({
    api_key: "KEY_fax_synthetic",
    connection_id: "234423",
    phone_number: "+15557654321",
    public_key: SYNTHETIC_PUBLIC_KEY
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.api_key_present, true);
  assert.equal(saved.inbound_webhook_material_present, true);

  const view = JSON.stringify(saved);
  assert.doesNotMatch(view, /KEY_fax_synthetic/);

  const raw = env.files.get("/data/telnyx-fax-settings.json");
  assert.doesNotMatch(raw, /KEY_fax_synthetic/);
  assert.match(raw, /telnyx_fax_api_key_encrypted/);
  // The settings file uses fax-specific keys, never the SMS field names.
  assert.doesNotMatch(raw, /messaging_profile/);

  const backendEnv = store.backendEnv();
  assert.equal(backendEnv.TELNYX_FAX_API_KEY, "KEY_fax_synthetic");
  assert.equal(backendEnv.TELNYX_FAX_CONNECTION_ID, "234423");
  assert.equal(backendEnv.TELNYX_FAX_PHONE_NUMBER, "+15557654321");
  assert.equal(backendEnv.TELNYX_FAX_PUBLIC_KEY, SYNTHETIC_PUBLIC_KEY);
  // No SMS/MMS env var names leak from the fax store.
  assert.equal(backendEnv.TELNYX_API_KEY, undefined);
  assert.equal(backendEnv.TELNYX_MESSAGING_PROFILE_ID, undefined);
});

test("TFX-001: reloads from disk and removes cleanly", () => {
  const env = makeEnv();
  let store = createTelnyxFaxSettingsStore(env);
  store.persist({ api_key: "KEY_a", connection_id: "app-1", phone_number: "+15557654321" });
  store = createTelnyxFaxSettingsStore(env);
  const reloaded = store.load();
  assert.equal(reloaded.configured, true);
  assert.equal(reloaded.connection_id, "app-1");
  assert.equal(store.backendEnv().TELNYX_FAX_API_KEY, "KEY_a");

  const removed = store.remove();
  assert.equal(removed.configured, false);
  assert.deepEqual(store.backendEnv(), {});
});

test("TFX-001: a bare Fax Application connection_id is accepted without assuming a UUID shape", () => {
  const env = makeEnv();
  const store = createTelnyxFaxSettingsStore(env);
  // Telnyx's own docs use a plain numeric-looking string, not a UUID.
  const saved = store.persist({ api_key: "KEY_a", connection_id: "1293384261075731499", phone_number: "+15557654321" });
  assert.equal(saved.connection_id, "1293384261075731499");
});

test("TFX-001: environment fallback uses TELNYX_FAX_* variables, never the generic SMS TELNYX_* names", () => {
  const env = makeEnv({
    TELNYX_FAX_API_KEY: "KEY_env",
    TELNYX_FAX_CONNECTION_ID: "app-env",
    TELNYX_FAX_PHONE_NUMBER: "+15557654322",
    // A generic/SMS Telnyx env var must NOT be silently treated as fax config.
    TELNYX_API_KEY: "KEY_sms_should_not_be_used",
    TELNYX_MESSAGING_PROFILE_ID: "profile-should-not-be-used"
  });
  const store = createTelnyxFaxSettingsStore(env);
  const loaded = store.load();
  assert.equal(loaded.configured, true);
  assert.equal(loaded.source, "environment");
  assert.equal(store.backendEnv().TELNYX_FAX_API_KEY, "KEY_env");
});

test("TFX-001: generic SMS-only environment variables do not configure fax", () => {
  const env = makeEnv({
    TELNYX_API_KEY: "KEY_sms",
    TELNYX_PHONE_NUMBER: "+15557654321",
    TELNYX_MESSAGING_PROFILE_ID: "profile-1"
  });
  const store = createTelnyxFaxSettingsStore(env);
  const loaded = store.load();
  assert.equal(loaded.configured, false);
  assert.deepEqual(store.backendEnv(), {});
});

test("TFX-004: read-only validation checks the Fax Application and phone number without mutating anything, and separates configured/outbound_ready/inbound_webhook_ready", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes("/fax_applications/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "app-1", application_name: "forgelink-fax", active: true, webhook_event_url: "https://example.invalid/hook", outbound: { outbound_voice_profile_id: "ovp-1" } } })
      };
    }
    if (String(url).includes("/phone_numbers")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ phone_number: "+15557654321", status: "active", connection_id: "app-1" }] })
      };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  };
  const result = await validateTelnyxFaxSettings({ api_key: "KEY_a", connection_id: "app-1", phone_number: "+15557654321", public_key: SYNTHETIC_PUBLIC_KEY }, fetchImpl);
  assert.equal(result.outbound_ready, true);
  assert.equal(result.inbound_webhook_ready, true);
  // Every call was a GET -- validation never mutates a Telnyx resource.
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.equal(calls.length, 2);
});

test("TFX-004: a Fax Application with no Outbound Voice Profile is configured but not outbound_ready", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/fax_applications/")) {
      return { ok: true, status: 200, json: async () => ({ data: { id: "app-1", application_name: "forgelink-fax", active: true, outbound: {} } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ phone_number: "+15557654321", status: "active", connection_id: "app-1" }] }) };
  };
  const result = await validateTelnyxFaxSettings({ api_key: "KEY_a", connection_id: "app-1", phone_number: "+15557654321" }, fetchImpl);
  assert.equal(result.outbound_ready, false);
  assert.match(result.outbound_ready_reason, /Outbound Voice Profile/);
  assert.equal(result.inbound_webhook_ready, false, "no public key means inbound webhook readiness cannot be claimed");
});

test("TFX-004: a missing or inactive Fax Application is rejected", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ errors: [{ detail: "not found" }] }) });
  await assert.rejects(() => validateTelnyxFaxSettings({ api_key: "KEY_a", connection_id: "app-missing", phone_number: "+15557654321" }, fetchImpl), /validation failed \(404\)/);
});

test("TFX-004: a phone number not assigned to the configured Fax Application is rejected", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/fax_applications/")) {
      return { ok: true, status: 200, json: async () => ({ data: { id: "app-1", active: true, outbound: { outbound_voice_profile_id: "ovp-1" } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ phone_number: "+15557654321", status: "active", connection_id: "app-OTHER" }] }) };
  };
  await assert.rejects(() => validateTelnyxFaxSettings({ api_key: "KEY_a", connection_id: "app-1", phone_number: "+15557654321" }, fetchImpl), /not assigned/);
});

test("TFX-004: a disabled/inactive phone number is rejected", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/fax_applications/")) {
      return { ok: true, status: 200, json: async () => ({ data: { id: "app-1", active: true, outbound: { outbound_voice_profile_id: "ovp-1" } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ phone_number: "+15557654321", status: "port-pending", connection_id: "app-1" }] }) };
  };
  await assert.rejects(() => validateTelnyxFaxSettings({ api_key: "KEY_a", connection_id: "app-1", phone_number: "+15557654321" }, fetchImpl), /not active/);
});

test("TFX-004: validation error messages never leak the API key or raw provider bodies", async () => {
  const fetchImpl = async () => ({ ok: false, status: 422, json: async () => ({ errors: [{ detail: "raw provider detail that must not leak" }] }) });
  try {
    await validateTelnyxFaxSettings({ api_key: "KEY_super_secret", connection_id: "app-1", phone_number: "+15557654321" }, fetchImpl);
    assert.fail("expected rejection");
  } catch (error) {
    assert.doesNotMatch(error.message, /KEY_super_secret/);
    assert.doesNotMatch(error.message, /raw provider detail/);
  }
});
