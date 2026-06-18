const { DEFAULT_ATTENTION_POLICY, normalizeAttentionPolicy } = require("./attention");

const DEFAULT_SETTINGS = {
  account_sid: "",
  auth_token: "",
  twilio_number: "",
  public_base_url: "",
  webhook_host: "127.0.0.1",
  webhook_port: 5055,
  onboarding_complete: false,
  attention_policy: DEFAULT_ATTENTION_POLICY
};

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (String(value || "").trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error("Enter the Twilio phone number in E.164 format, such as +15551234567.");
}

function validateLocalSettings(settings) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  next.attention_policy = normalizeAttentionPolicy(next.attention_policy);
  next.account_sid = String(next.account_sid || "").trim();
  next.auth_token = String(next.auth_token || "").trim();
  next.twilio_number = normalizePhone(next.twilio_number);
  next.public_base_url = String(next.public_base_url || "").trim().replace(/\/$/, "");
  next.webhook_host = String(next.webhook_host || DEFAULT_SETTINGS.webhook_host);
  next.webhook_port = Number(next.webhook_port || DEFAULT_SETTINGS.webhook_port);
  if (!/^AC[a-fA-F0-9]{32}$/.test(next.account_sid)) throw new Error("Enter a valid Twilio Account SID beginning with AC.");
  if (!next.auth_token) throw new Error("Enter the Twilio auth token.");
  if (next.public_base_url && !next.public_base_url.startsWith("https://")) throw new Error("The public webhook URL must use HTTPS.");
  if (!new Set(["127.0.0.1", "localhost"]).has(next.webhook_host)) throw new Error("Local service host must remain on loopback.");
  if (!Number.isInteger(next.webhook_port) || next.webhook_port < 1024 || next.webhook_port > 65535) throw new Error("Local service port must be between 1024 and 65535.");
  return next;
}

function validateAttentionPolicy(policy) {
  return normalizeAttentionPolicy(policy);
}

async function validateTwilioCredentials(settings, fetchImpl = fetch) {
  const next = validateLocalSettings(settings);
  const authorization = `Basic ${Buffer.from(`${next.account_sid}:${next.auth_token}`).toString("base64")}`;
  const accountResponse = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${next.account_sid}.json`, {
    headers: { Authorization: authorization }, signal: AbortSignal.timeout(20_000)
  });
  if (!accountResponse.ok) throw new Error(accountResponse.status === 401 ? "Twilio rejected the Account SID or auth token." : `Twilio account validation failed (${accountResponse.status}).`);
  const account = await accountResponse.json();
  const numbersResponse = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${next.account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(next.twilio_number)}&PageSize=1`, {
    headers: { Authorization: authorization }, signal: AbortSignal.timeout(20_000)
  });
  if (!numbersResponse.ok) throw new Error(`Twilio phone-number validation failed (${numbersResponse.status}).`);
  const numbers = await numbersResponse.json();
  if (!Array.isArray(numbers.incoming_phone_numbers) || !numbers.incoming_phone_numbers.some((number) => number.phone_number === next.twilio_number)) {
    throw new Error("That phone number was not found in this Twilio account.");
  }
  return { settings: next, account_name: String(account.friendly_name || "Twilio account"), account_status: String(account.status || "active"), phone_number: next.twilio_number };
}

// Point the Twilio number's inbound SMS webhook at <publicBaseUrl>/webhooks/sms.
// Used to auto-configure delivery once a tunnel URL is known (work item 014).
async function configureNumberWebhook(settings, publicBaseUrl, fetchImpl = fetch) {
  const next = validateLocalSettings(settings);
  const base = String(publicBaseUrl || "").trim().replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("A public HTTPS base URL is required to configure the Twilio webhook.");
  const authorization = `Basic ${Buffer.from(`${next.account_sid}:${next.auth_token}`).toString("base64")}`;
  const lookup = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${next.account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(next.twilio_number)}&PageSize=1`, {
    headers: { Authorization: authorization }, signal: AbortSignal.timeout(20_000)
  });
  if (!lookup.ok) throw new Error(`Twilio phone-number lookup failed (${lookup.status}).`);
  const data = await lookup.json();
  const record = Array.isArray(data.incoming_phone_numbers) ? data.incoming_phone_numbers.find((number) => number.phone_number === next.twilio_number) : null;
  if (!record || !record.sid) throw new Error("That phone number was not found in this Twilio account.");
  const smsUrl = `${base}/webhooks/sms`;
  const body = new URLSearchParams({ SmsUrl: smsUrl, SmsMethod: "POST" }).toString();
  const update = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${next.account_sid}/IncomingPhoneNumbers/${record.sid}.json`, {
    method: "POST", headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000)
  });
  if (!update.ok) throw new Error(`Twilio webhook update failed (${update.status}).`);
  return { sid: record.sid, sms_url: smsUrl };
}

function createSettingsStore({ fs, path, safeStorage, env, userData, legacyUserData }) {
  const file = path.join(userData, "settings.json");
  const legacyFiles = legacyUserData ? [path.join(legacyUserData, "settings.json")] : [];
  let settings = { ...DEFAULT_SETTINGS };
  let source = "none";
  let environmentAvailable = false;

  function environmentSettings() {
    return {
      account_sid: env.TWILIO_ACCOUNT_SID || "",
      auth_token: env.TWILIO_AUTH_TOKEN || "",
      twilio_number: env.TWILIO_PHONE_NUMBER || "",
      public_base_url: env.TWILIO_PUBLIC_BASE_URL || "",
      webhook_host: env.TWILIO_PHONE_HOST || DEFAULT_SETTINGS.webhook_host,
      webhook_port: Number(env.TWILIO_PHONE_PORT || DEFAULT_SETTINGS.webhook_port)
    };
  }

  function load() {
    let stored = null;
    for (const candidate of [file, ...legacyFiles]) {
      try {
        stored = JSON.parse(fs.readFileSync(candidate, "utf8"));
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (stored) {
      settings = { ...DEFAULT_SETTINGS, ...stored, auth_token: "" };
      settings.attention_policy = normalizeAttentionPolicy(stored.attention_policy);
      if (stored.auth_token_encrypted) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
        settings.auth_token = safeStorage.decryptString(Buffer.from(stored.auth_token_encrypted, "base64"));
      }
      source = settings.account_sid && settings.auth_token && settings.twilio_number ? "stored" : "none";
    }
    const fromEnvironment = environmentSettings();
    environmentAvailable = Boolean(fromEnvironment.account_sid && fromEnvironment.auth_token && fromEnvironment.twilio_number);
    if (source === "none" && environmentAvailable) { settings = { ...settings, ...fromEnvironment }; source = "environment"; }
    return current();
  }

  function persist(nextValue) {
    const next = validateLocalSettings({ ...settings, ...nextValue, auth_token: nextValue.auth_token || settings.auth_token, onboarding_complete: true });
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    const stored = { ...next, auth_token_encrypted: safeStorage.encryptString(next.auth_token).toString("base64") };
    delete stored.auth_token;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    settings = next; source = "stored";
    return current();
  }

  function persistAttentionPolicy(policy) {
    const next = { ...settings, attention_policy: normalizeAttentionPolicy(policy) };
    if (settings.auth_token) return persist(next);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    settings = next;
    return current();
  }

  function importEnvironment() {
    if (!environmentAvailable) throw new Error("Complete Twilio environment credentials were not found.");
    return persist(environmentSettings());
  }

  function removeCredentials() {
    const retained = { ...DEFAULT_SETTINGS, webhook_host: settings.webhook_host, webhook_port: settings.webhook_port };
    for (const candidate of [file, ...legacyFiles]) {
      try { fs.unlinkSync(candidate); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    settings = retained; source = "none"; environmentAvailable = false;
    return current();
  }

  function current() { return { settings: { ...settings, attention_policy: normalizeAttentionPolicy(settings.attention_policy) }, source, environmentAvailable, configured: Boolean(settings.account_sid && settings.auth_token && settings.twilio_number) }; }
  return { current, importEnvironment, load, persist, persistAttentionPolicy, removeCredentials };
}

module.exports = { DEFAULT_SETTINGS, createSettingsStore, normalizePhone, validateAttentionPolicy, validateLocalSettings, validateTwilioCredentials, configureNumberWebhook };
