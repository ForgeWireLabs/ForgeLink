// Secure email credential storage (work item 018, EMAIL-002).
//
// SMTP credentials and the inbound/quick-action secrets are stored OS-encrypted
// via Electron safeStorage in the main process — never in the local database,
// never in plaintext, and never returned to the renderer. The renderer only ever
// sees a redacted view (booleans + non-secret host/from). On backend launch, main
// injects the decrypted values into the utility-process environment so the
// existing backend reads them through the normal FORGELINK_SMTP_*/EMAIL_* config.

function createEmailSettingsStore({ fs, path, safeStorage, userData }) {
  const file = path.join(userData, "email-settings.json");
  let config = { host: "", port: 465, secure: true, user: "", from: "" };
  let smtpPass = "";
  let inboundSecret = "";
  let actionSecret = "";

  function decrypt(encoded) {
    if (!encoded) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  function load() {
    let stored = null;
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stored) {
      const port = Number(stored.port) || 465;
      config = {
        host: String(stored.host || "").trim(),
        port,
        secure: stored.secure === undefined ? port === 465 : Boolean(stored.secure),
        user: String(stored.user || "").trim(),
        from: String(stored.from || "").trim()
      };
      smtpPass = decrypt(stored.smtp_pass_encrypted);
      inboundSecret = decrypt(stored.inbound_secret_encrypted);
      actionSecret = decrypt(stored.action_secret_encrypted);
    }
    return current();
  }

  function persist(input = {}) {
    const port = Number(input.port || config.port || 465) || 465;
    const next = {
      host: String(input.host !== undefined ? input.host : config.host).trim(),
      port,
      secure: input.secure === undefined ? (input.port !== undefined ? port === 465 : config.secure) : Boolean(input.secure),
      user: String(input.user !== undefined ? input.user : config.user).trim(),
      from: String(input.from !== undefined ? input.from : config.from).trim() || String(input.user !== undefined ? input.user : config.user).trim()
    };
    if (!next.host || !next.user) throw new Error("Email requires an SMTP host and username.");
    // A blank secret input keeps the existing stored secret (so the renderer never
    // has to re-send it). Empty stored + blank input on a required field is an error.
    const pass = input.pass ? String(input.pass) : smtpPass;
    if (!pass) throw new Error("Email requires an SMTP password or token.");
    const inbound = input.inbound_secret !== undefined ? String(input.inbound_secret) : inboundSecret;
    const action = input.action_secret !== undefined ? String(input.action_secret) : actionSecret;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    const stored = { ...next, smtp_pass_encrypted: safeStorage.encryptString(pass).toString("base64") };
    if (inbound) stored.inbound_secret_encrypted = safeStorage.encryptString(inbound).toString("base64");
    if (action) stored.action_secret_encrypted = safeStorage.encryptString(action).toString("base64");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    config = next; smtpPass = pass; inboundSecret = inbound; actionSecret = action;
    return current();
  }

  function remove() {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    config = { host: "", port: 465, secure: true, user: "", from: "" };
    smtpPass = ""; inboundSecret = ""; actionSecret = "";
    return current();
  }

  // Environment injected into the backend utility process at launch, so the backend
  // reads stored credentials through its normal config. Decrypted values live only
  // in this main-process env hand-off, never in the renderer or the database.
  function backendEnv() {
    const out = {};
    if (config.host && config.user && smtpPass && config.from) {
      out.FORGELINK_SMTP_HOST = config.host;
      out.FORGELINK_SMTP_PORT = String(config.port);
      out.FORGELINK_SMTP_SECURE = config.secure ? "1" : "0";
      out.FORGELINK_SMTP_USER = config.user;
      out.FORGELINK_SMTP_PASS = smtpPass;
      out.FORGELINK_SMTP_FROM = config.from;
    }
    if (inboundSecret) out.FORGELINK_EMAIL_INBOUND_SECRET = inboundSecret;
    if (actionSecret) out.FORGELINK_EMAIL_ACTION_SECRET = actionSecret;
    return out;
  }

  // Redacted, renderer-safe view: never the password or secrets, only presence.
  function current() {
    return {
      configured: Boolean(config.host && config.user && smtpPass && config.from),
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      password_present: Boolean(smtpPass),
      inbound_secret_present: Boolean(inboundSecret),
      action_secret_present: Boolean(actionSecret)
    };
  }

  return { load, persist, remove, backendEnv, current };
}

module.exports = { createEmailSettingsStore };
