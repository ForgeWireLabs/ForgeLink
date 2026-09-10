// Telnyx Programmable Fax settings (work item 041, Phase 2: FAX-004).
//
// A deliberately separate configuration family from SMS/MMS
// (smsProviderSettings.js): a Telnyx Fax Application is not a Messaging
// Profile, and the same real Telnyx account credential may eventually be
// entered for both product families without merging their ownership.
// Secrets are OS-encrypted via Electron safeStorage in the main process --
// never in SQLite, never in plaintext, never returned to the renderer. The
// renderer only ever sees a redacted view (booleans + non-secret connection/
// phone number). On backend launch, main injects the decrypted values into
// the utility-process environment so the backend reads them through the
// normal TELNYX_FAX_* config (backend/src/telnyx-fax.ts).

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) throw new Error("Enter the Telnyx fax phone number in E.164 format, such as +15551234567.");
  return raw;
}

// A Fax Application connection_id is a plain string per Telnyx's current API
// (example "234423" in their own docs) -- NOT necessarily a UUID and not
// necessarily numeric. Validate only bounded, printable, non-empty -- do not
// assume a UUID shape merely because other Telnyx resources (messaging
// profiles) use one.
function normalizeConnectionId(value) {
  const connectionId = String(value || "").trim();
  if (!connectionId || connectionId.length > 64 || !/^[\x21-\x7e]+$/.test(connectionId)) {
    throw new Error("Enter a valid Telnyx Fax Application (connection) ID.");
  }
  return connectionId;
}

function validatePublicKey(value) {
  const publicKey = String(value || "").trim();
  if (!publicKey) return "";
  let decoded;
  try { decoded = Buffer.from(publicKey, "base64"); } catch { decoded = Buffer.alloc(0); }
  if (decoded.length !== 32) throw new Error("Enter the 32-byte base64 Telnyx webhook public key.");
  return publicKey;
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

function redactedFaxError(status, action = "validation") {
  return new Error(`Telnyx Fax ${action} failed (${status}). Check the API key, Fax Application connection ID, and phone number.`);
}

// Read-only validation (work item 041, FAX-004): establishes the strongest
// truth Telnyx's own APIs can prove without mutating any Telnyx resource.
// Separates "configured" (candidate values present) from "outbound_ready"
// (the Fax Application has an Outbound Voice Profile attached -- required for
// outbound fax) from "inbound_webhook_ready" (a webhook public key is present
// locally AND the Fax Application has a webhook event URL configured). A Fax
// Application being retrievable is not by itself proof that outbound fax is
// ready -- see docs/telnyx-fax.md.
async function validateTelnyxFaxSettings(settings, fetchImpl = fetch) {
  const apiKey = String(settings.api_key || "").trim();
  if (!apiKey) throw new Error("Telnyx Fax requires an API key.");
  const connectionId = normalizeConnectionId(settings.connection_id);
  const phoneNumber = normalizePhone(settings.phone_number);
  const publicKey = validatePublicKey(settings.public_key);
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  const appResponse = await fetchImpl(`https://api.telnyx.com/v2/fax_applications/${encodeURIComponent(connectionId)}`, {
    method: "GET", headers, signal: AbortSignal.timeout(20_000)
  });
  const appJson = await readJson(appResponse);
  if (!appResponse.ok) throw redactedFaxError(appResponse.status);
  const application = appJson && appJson.data ? appJson.data : {};
  if (String(application.id || "") !== connectionId) throw new Error("Telnyx did not return the selected Fax Application.");
  if (application.active === false) throw new Error("The selected Telnyx Fax Application is disabled.");
  const outboundVoiceProfileId = application.outbound && application.outbound.outbound_voice_profile_id;

  const numberResponse = await fetchImpl(`https://api.telnyx.com/v2/phone_numbers?filter%5Bphone_number%5D=${encodeURIComponent(phoneNumber)}`, {
    method: "GET", headers, signal: AbortSignal.timeout(20_000)
  });
  const numberJson = await readJson(numberResponse);
  if (!numberResponse.ok) throw redactedFaxError(numberResponse.status);
  const matches = Array.isArray(numberJson && numberJson.data) ? numberJson.data : [];
  const number = matches.find((candidateNumber) => String(candidateNumber.phone_number || "") === phoneNumber);
  if (!number) throw new Error("Telnyx did not return the selected phone number.");
  if (String(number.status || "") !== "active") throw new Error("The selected Telnyx phone number is not active.");
  if (String(number.connection_id || "") !== connectionId) throw new Error("The selected phone number is not assigned to the selected Fax Application.");

  const outboundReady = Boolean(outboundVoiceProfileId);
  const inboundWebhookReady = Boolean(publicKey) && Boolean(application.webhook_event_url);
  return {
    provider: "telnyx",
    application_name: String(application.application_name || "Telnyx Fax"),
    connection_id: connectionId,
    phone_number: phoneNumber,
    outbound_ready: outboundReady,
    inbound_webhook_ready: inboundWebhookReady,
    outbound_ready_reason: outboundReady ? "" : "The Fax Application has no Outbound Voice Profile attached."
  };
}

function createTelnyxFaxSettingsStore({ fs, path, safeStorage, env, userData }) {
  const file = path.join(userData, "telnyx-fax-settings.json");
  let fax = { api_key: "", connection_id: "", phone_number: "", public_key: "" };
  let source = "none";

  function environmentFax() {
    return {
      api_key: String(env.TELNYX_FAX_API_KEY || "").trim(),
      connection_id: String(env.TELNYX_FAX_CONNECTION_ID || "").trim(),
      phone_number: String(env.TELNYX_FAX_PHONE_NUMBER || "").trim(),
      public_key: String(env.TELNYX_FAX_PUBLIC_KEY || "").trim()
    };
  }

  function environmentAvailable() {
    const candidate = environmentFax();
    return Boolean(candidate.api_key && candidate.connection_id && candidate.phone_number);
  }

  function decrypt(encoded) {
    if (!encoded) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  function load() {
    let stored = null;
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stored) {
      fax = {
        api_key: decrypt(stored.telnyx_fax_api_key_encrypted),
        connection_id: String(stored.telnyx_fax_connection_id || "").trim(),
        phone_number: String(stored.telnyx_fax_phone_number || "").trim(),
        public_key: decrypt(stored.telnyx_fax_public_key_encrypted)
      };
      source = fax.api_key && fax.connection_id && fax.phone_number ? "stored" : "none";
    }
    if (source === "none" && environmentAvailable()) { fax = environmentFax(); source = "environment"; }
    return current();
  }

  function candidate(input = {}) {
    return {
      api_key: input.api_key ? String(input.api_key).trim() : fax.api_key,
      connection_id: input.connection_id !== undefined ? String(input.connection_id).trim() : fax.connection_id,
      phone_number: input.phone_number !== undefined ? String(input.phone_number).trim() : fax.phone_number,
      public_key: input.public_key !== undefined ? String(input.public_key).trim() : fax.public_key
    };
  }

  function persist(input = {}) {
    const next = candidate(input);
    if (!next.api_key) throw new Error("Telnyx Fax requires an API key.");
    next.connection_id = normalizeConnectionId(next.connection_id);
    next.phone_number = normalizePhone(next.phone_number);
    next.public_key = validatePublicKey(next.public_key);
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    const stored = {
      telnyx_fax_connection_id: next.connection_id,
      telnyx_fax_phone_number: next.phone_number,
      telnyx_fax_api_key_encrypted: safeStorage.encryptString(next.api_key).toString("base64")
    };
    if (next.public_key) stored.telnyx_fax_public_key_encrypted = safeStorage.encryptString(next.public_key).toString("base64");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    fax = next; source = "stored";
    return current();
  }

  function remove() {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    fax = { api_key: "", connection_id: "", phone_number: "", public_key: "" }; source = "none";
    if (environmentAvailable()) { fax = environmentFax(); source = "environment"; }
    return current();
  }

  // Environment injected into the backend utility process at launch. Never
  // written to SQLite, never returned to the renderer, never placed in
  // RepoPact evidence. Deliberately separate variable names from the SMS/MMS
  // Telnyx config (TELNYX_API_KEY etc.) even when an operator enters the same
  // underlying Telnyx account credential for both -- configuration ownership
  // stays separate.
  function backendEnv() {
    const out = {};
    if (fax.api_key && fax.connection_id && fax.phone_number) {
      out.TELNYX_FAX_API_KEY = fax.api_key;
      out.TELNYX_FAX_CONNECTION_ID = fax.connection_id;
      out.TELNYX_FAX_PHONE_NUMBER = fax.phone_number;
      if (fax.public_key) out.TELNYX_FAX_PUBLIC_KEY = fax.public_key;
    }
    return out;
  }

  // Redacted, renderer-safe view: never the API key or public key material,
  // only presence/non-secret identifiers.
  function current() {
    return {
      configured: Boolean(fax.api_key && fax.connection_id && fax.phone_number),
      inbound_webhook_material_present: Boolean(fax.public_key),
      source,
      environment_available: environmentAvailable(),
      connection_id: fax.connection_id,
      phone_number: fax.phone_number,
      api_key_present: Boolean(fax.api_key),
      public_key_present: Boolean(fax.public_key)
    };
  }

  return { load, persist, remove, backendEnv, current, candidate };
}

module.exports = { createTelnyxFaxSettingsStore, validateTelnyxFaxSettings, normalizePhone, normalizeConnectionId, validatePublicKey };
