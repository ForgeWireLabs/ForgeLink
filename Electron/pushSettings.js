// Secure push credential storage (work item 019, PUSH-003).
//
// The push provider token AND the topic are stored OS-encrypted via Electron
// safeStorage in the main process. The topic is treated as a secret: on a shared
// provider like ntfy.sh, anyone who knows the topic can publish to and read from it,
// so it is a delivery credential, not a label. Neither the token nor the topic is
// ever written in plaintext, returned to the renderer, or placed in the database.
// The renderer sees only a redacted view (presence booleans + non-secret provider/
// URL/profile). On backend launch, main injects the decrypted values into the
// utility-process env so the backend reads them through the normal FORGELINK_PUSH_*
// config.
//
// Rotation/revoke: re-saving with a new topic/token rotates the delivery identity
// (the old topic/token simply stops being used); remove() revokes by clearing the
// stored credentials so the channel goes disabled and nothing is sent.

const PUSH_PROFILES = new Set(["lock_screen_safe", "full"]);

function normalizeProfile(value, fallback = "lock_screen_safe") {
  const raw = String(value || "").trim().toLowerCase();
  return PUSH_PROFILES.has(raw) ? raw : fallback;
}

function createPushSettingsStore({ fs, path, safeStorage, userData }) {
  const file = path.join(userData, "push-settings.json");
  let config = { provider: "ntfy", url: "https://ntfy.sh", profile: "lock_screen_safe" };
  let topic = "";
  let token = "";

  function decrypt(encoded) {
    if (!encoded) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  function load() {
    let stored = null;
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stored) {
      config = {
        provider: String(stored.provider || "ntfy").trim() || "ntfy",
        url: String(stored.url || "https://ntfy.sh").trim().replace(/\/+$/, "") || "https://ntfy.sh",
        profile: normalizeProfile(stored.profile)
      };
      topic = decrypt(stored.topic_encrypted);
      token = decrypt(stored.token_encrypted);
    }
    return current();
  }

  function persist(input = {}) {
    const next = {
      provider: String(input.provider !== undefined ? input.provider : config.provider).trim() || "ntfy",
      url: String(input.url !== undefined ? input.url : config.url).trim().replace(/\/+$/, ""),
      profile: normalizeProfile(input.profile !== undefined ? input.profile : config.profile)
    };
    if (!next.url) throw new Error("Push requires a provider URL.");
    // A blank topic/token input keeps the existing stored secret (so the renderer
    // never has to re-send it). The topic is required (stored or supplied).
    const nextTopic = input.topic ? String(input.topic).trim() : topic;
    if (!nextTopic) throw new Error("Push requires a topic.");
    const nextToken = input.token !== undefined ? String(input.token) : token;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    const stored = { ...next, topic_encrypted: safeStorage.encryptString(nextTopic).toString("base64") };
    if (nextToken) stored.token_encrypted = safeStorage.encryptString(nextToken).toString("base64");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    config = next; topic = nextTopic; token = nextToken;
    return current();
  }

  function remove() {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    config = { provider: "ntfy", url: "https://ntfy.sh", profile: "lock_screen_safe" };
    topic = ""; token = "";
    return current();
  }

  // Environment injected into the backend utility process at launch. Decrypted
  // values live only in this main-process env hand-off, never in the renderer or DB.
  function backendEnv() {
    const out = {};
    if (config.url && topic) {
      out.FORGELINK_PUSH_PROVIDER = config.provider;
      out.FORGELINK_PUSH_URL = config.url;
      out.FORGELINK_PUSH_TOPIC = topic;
      out.FORGELINK_PUSH_PROFILE = config.profile;
      if (token) out.FORGELINK_PUSH_TOKEN = token;
    }
    return out;
  }

  // Redacted, renderer-safe view: never the topic or token, only presence.
  function current() {
    return {
      configured: Boolean(config.url && topic),
      provider: config.provider,
      url: config.url,
      profile: config.profile,
      topic_present: Boolean(topic),
      token_present: Boolean(token)
    };
  }

  return { load, persist, remove, backendEnv, current };
}

module.exports = { createPushSettingsStore };
