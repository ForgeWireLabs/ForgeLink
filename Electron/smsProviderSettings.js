// First-class SMS/MMS provider settings (work item 035).
//
// Telnyx secrets are owned by the desktop shell and encrypted with Electron
// safeStorage. The renderer receives only a redacted status object. A complete
// environment configuration remains a read-only fallback for existing operators.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) throw new Error("Enter the Telnyx phone number in E.164 format, such as +15551234567.");
  return raw;
}

function normalizeProfileId(value) {
  const profileId = String(value || "").trim();
  if (!UUID.test(profileId)) throw new Error("Enter a valid Telnyx messaging profile ID.");
  return profileId;
}

function validatePublicKey(value) {
  const publicKey = String(value || "").trim();
  let decoded;
  try { decoded = Buffer.from(publicKey, "base64"); } catch { decoded = Buffer.alloc(0); }
  if (decoded.length !== 32) throw new Error("Enter the 32-byte base64 Telnyx webhook public key.");
  return publicKey;
}

function redactedProviderError(status, action = "validation") {
  return new Error(`Telnyx ${action} failed (${status}). Check the API key, phone number, and messaging profile.`);
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

async function validateTelnyxSettings(settings, fetchImpl = fetch) {
  const apiKey = String(settings.api_key || "").trim();
  if (!apiKey) throw new Error("Telnyx requires an API key.");
  const phoneNumber = normalizePhone(settings.phone_number);
  const publicKey = validatePublicKey(settings.public_key);
  const profileId = normalizeProfileId(settings.messaging_profile_id);
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  const numberResponse = await fetchImpl(`https://api.telnyx.com/v2/messaging_phone_numbers/${encodeURIComponent(phoneNumber)}`, {
    method: "GET", headers, signal: AbortSignal.timeout(20_000)
  });
  const numberJson = await readJson(numberResponse);
  if (!numberResponse.ok) throw redactedProviderError(numberResponse.status);
  const number = numberJson && numberJson.data ? numberJson.data : {};
  if (String(number.phone_number || "") !== phoneNumber) throw new Error("Telnyx did not return the selected phone number.");
  if (String(number.messaging_profile_id || "") !== profileId) throw new Error("The Telnyx phone number is not assigned to the selected messaging profile.");
  if (number.features && (number.features.sms === null || number.features.sms === false)) throw new Error("The selected Telnyx phone number is not SMS-capable.");

  const profileResponse = await fetchImpl(`https://api.telnyx.com/v2/messaging_profiles/${encodeURIComponent(profileId)}`, {
    method: "GET", headers, signal: AbortSignal.timeout(20_000)
  });
  const profileJson = await readJson(profileResponse);
  if (!profileResponse.ok) throw redactedProviderError(profileResponse.status);
  const profile = profileJson && profileJson.data ? profileJson.data : {};
  if (String(profile.id || "") !== profileId) throw new Error("Telnyx did not return the selected messaging profile.");
  if (profile.enabled === false) throw new Error("The selected Telnyx messaging profile is disabled.");

  return {
    provider: "telnyx",
    account_name: String(profile.name || "Telnyx messaging"),
    account_status: "active",
    phone_number: phoneNumber,
    messaging_profile_id: profileId,
    messaging_profile_name: String(profile.name || ""),
    webhook_configured: Boolean(profile.webhook_url),
    public_key_valid: Boolean(publicKey)
  };
}

async function configureTelnyxWebhook(settings, publicBaseUrl, fetchImpl = fetch) {
  const apiKey = String(settings.api_key || "").trim();
  const profileId = normalizeProfileId(settings.messaging_profile_id);
  const baseUrl = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!apiKey) throw new Error("Telnyx requires an API key.");
  if (!baseUrl.startsWith("https://")) throw new Error("Telnyx webhook setup requires a public HTTPS base URL.");
  const webhookUrl = `${baseUrl}/webhooks/telnyx`;
  const response = await fetchImpl(`https://api.telnyx.com/v2/messaging_profiles/${encodeURIComponent(profileId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ webhook_url: webhookUrl, webhook_api_version: "2" }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) { await readJson(response); throw redactedProviderError(response.status, "webhook setup"); }
  await readJson(response);
  return { configured: true, webhook_url: webhookUrl };
}

function createSmsProviderSettingsStore({ fs, path, safeStorage, env, userData, twilioConfigured = () => false }) {
  const file = path.join(userData, "sms-provider-settings.json");
  const environmentPreference = String(env.FORGELINK_SMS_PROVIDER || "").toLowerCase();
  let preferredProvider = environmentPreference === "telnyx" || environmentPreference === "twilio" || environmentPreference === "none"
    ? environmentPreference
    : "none";
  let source = "none";
  let telnyx = { api_key: "", phone_number: "", public_key: "", messaging_profile_id: "" };

  function environmentTelnyx() {
    return {
      api_key: String(env.TELNYX_API_KEY || "").trim(),
      phone_number: String(env.TELNYX_PHONE_NUMBER || "").trim(),
      public_key: String(env.TELNYX_PUBLIC_KEY || "").trim(),
      messaging_profile_id: String(env.TELNYX_MESSAGING_PROFILE_ID || "").trim()
    };
  }

  function decrypt(encoded) {
    if (!encoded) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  function environmentAvailable() {
    const candidate = environmentTelnyx();
    return Boolean(candidate.api_key && candidate.phone_number);
  }

  function load() {
    let stored = null;
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stored) {
      preferredProvider = stored.preferred_provider === "telnyx" || stored.preferred_provider === "twilio" || stored.preferred_provider === "none"
        ? stored.preferred_provider
        : "none";
      telnyx = {
        api_key: decrypt(stored.telnyx_api_key_encrypted),
        phone_number: String(stored.telnyx_phone_number || "").trim(),
        public_key: decrypt(stored.telnyx_public_key_encrypted),
        messaging_profile_id: String(stored.telnyx_messaging_profile_id || "").trim()
      };
      source = telnyx.api_key && telnyx.phone_number ? "stored" : "none";
    }
    if (source === "none" && environmentAvailable()) { telnyx = environmentTelnyx(); source = "environment"; }
    if (!stored && !environmentPreference && twilioConfigured()) preferredProvider = "twilio";
    if (preferredProvider === "telnyx" && !telnyx.api_key) preferredProvider = twilioConfigured() ? "twilio" : "none";
    if (preferredProvider === "twilio" && !twilioConfigured()) preferredProvider = "none";
    return current();
  }

  function candidate(input = {}) {
    return {
      api_key: input.api_key ? String(input.api_key).trim() : telnyx.api_key,
      phone_number: input.phone_number !== undefined ? String(input.phone_number).trim() : telnyx.phone_number,
      public_key: input.public_key ? String(input.public_key).trim() : telnyx.public_key,
      messaging_profile_id: input.messaging_profile_id !== undefined ? String(input.messaging_profile_id).trim() : telnyx.messaging_profile_id
    };
  }

  function writeStored(next, nextPreferred) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    const stored = {
      preferred_provider: nextPreferred,
      telnyx_phone_number: next.phone_number,
      telnyx_messaging_profile_id: next.messaging_profile_id,
      telnyx_api_key_encrypted: safeStorage.encryptString(next.api_key).toString("base64"),
      telnyx_public_key_encrypted: safeStorage.encryptString(next.public_key).toString("base64")
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }

  function writePreference(nextPreferred) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ preferred_provider: nextPreferred }, null, 2), { mode: 0o600 });
  }

  function persist(input = {}) {
    const next = candidate(input);
    if (!next.api_key) throw new Error("Telnyx requires an API key.");
    next.phone_number = normalizePhone(next.phone_number);
    next.public_key = validatePublicKey(next.public_key);
    next.messaging_profile_id = normalizeProfileId(next.messaging_profile_id);
    const nextPreferred = input.preferred_provider === "none" || input.preferred_provider === "twilio" || input.preferred_provider === "telnyx"
      ? input.preferred_provider
      : preferredProvider === "telnyx"
        ? "telnyx"
        : "none";
    writeStored(next, nextPreferred);
    telnyx = next; preferredProvider = nextPreferred; source = "stored";
    return current();
  }

  function select(provider) {
    const next = String(provider || "").toLowerCase();
    if (next !== "none" && next !== "twilio" && next !== "telnyx") throw new Error("Select local-only, Twilio, or Telnyx for SMS/MMS.");
    if (next === "twilio" && !twilioConfigured()) throw new Error("Configure Twilio before selecting it.");
    if (next === "telnyx" && !(telnyx.api_key && telnyx.phone_number)) throw new Error("Configure Telnyx before selecting it.");
    preferredProvider = next;
    if (source === "stored") writeStored(telnyx, preferredProvider);
    else writePreference(preferredProvider);
    return current();
  }

  function removeTelnyx() {
    const removingSelectedProvider = preferredProvider === "telnyx";
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    preferredProvider = removingSelectedProvider
      ? (twilioConfigured() ? "twilio" : "none")
      : preferredProvider === "twilio" && twilioConfigured()
        ? "twilio"
        : "none";
    telnyx = { api_key: "", phone_number: "", public_key: "", messaging_profile_id: "" }; source = "none";
    if (environmentAvailable()) { telnyx = environmentTelnyx(); source = "environment"; }
    return current();
  }

  function backendEnv() {
    const out = { FORGELINK_SMS_PROVIDER: preferredProvider };
    if (telnyx.api_key && telnyx.phone_number) {
      out.TELNYX_API_KEY = telnyx.api_key;
      out.TELNYX_PHONE_NUMBER = telnyx.phone_number;
      if (telnyx.public_key) out.TELNYX_PUBLIC_KEY = telnyx.public_key;
      if (telnyx.messaging_profile_id) out.TELNYX_MESSAGING_PROFILE_ID = telnyx.messaging_profile_id;
    }
    return out;
  }

  function current() {
    return {
      preferred_provider: preferredProvider,
      telnyx: {
        configured: Boolean(telnyx.api_key && telnyx.phone_number),
        inbound_configured: Boolean(telnyx.public_key && telnyx.messaging_profile_id),
        source,
        environment_available: environmentAvailable(),
        phone_number: telnyx.phone_number,
        messaging_profile_id: telnyx.messaging_profile_id,
        api_key_present: Boolean(telnyx.api_key),
        public_key_present: Boolean(telnyx.public_key)
      }
    };
  }

  return { load, persist, select, removeTelnyx, backendEnv, current, candidate };
}

module.exports = { createSmsProviderSettingsStore, validateTelnyxSettings, configureTelnyxWebhook, normalizePhone, validatePublicKey };
