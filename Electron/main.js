const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { evaluateAttention, normalizeAttentionPolicy } = require("./attention");
const { createSettingsStore, validateTwilioCredentials, configureNumberWebhook } = require("./onboarding");
const { createEmailSettingsStore } = require("./emailSettings");
const { createPushSettingsStore } = require("./pushSettings");
const { createSmsProviderSettingsStore, validateTelnyxSettings, configureTelnyxWebhook } = require("./smsProviderSettings");
const { createTunnelManager } = require("./tunnel");
const { findAvailablePort, createRestartPolicy } = require("./lifecycle");
const { shouldAutoUpdate } = require("./updates");

const APP_NAME = "ForgeLink";
const apiToken = randomBytes(32).toString("base64url");

let backendProcess = null;
let mainWindow = null;
let settingsStore = null;
let emailSettingsStore = null;
let pushSettingsStore = null;
let smsProviderSettingsStore = null;
let tunnel = null;
let tunnelPublicUrl = "";
let effectivePort = 0;
let lastExitCode = null;
let recoveryMessage = "";
const backendRestarts = createRestartPolicy({ maxRestarts: 5, windowMs: 60_000 });

function backendEntryPath() {
  if (app.isPackaged && __dirname.includes("app.asar")) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "backend-dist", "index.js");
  }
  return path.join(__dirname, "backend-dist", "index.js");
}

function tunnelService() {
  if (!tunnel) {
    const binDir = path.join(app.getPath("userData"), "bin");
    const resourcePath = path.join(process.resourcesPath || __dirname, "cloudflared.exe");
    tunnel = createTunnelManager({ binDir, resourcePath });
  }
  return tunnel;
}

function settingsState() {
  return settingsStore.current();
}

function baseUrl() {
  const settings = settingsState().settings;
  return `http://${settings.webhook_host}:${effectivePort || settings.webhook_port}`;
}

function mcpTokenFile() {
  return path.join(os.homedir(), ".forgelink", "api.token");
}

function channelTokenFile(channelId = "forgewire") {
  return path.join(os.homedir(), ".forgelink", "channels", `${channelId}.token`);
}

function localIntegrationTokenFile(integrationId) {
  return path.join(os.homedir(), ".forgelink", "local-integrations", `${integrationId}.token`);
}

function mcpServerPath() {
  return path.resolve(__dirname, "..", "mcp", "forgelink-human", "dist", "server.js");
}

async function backendJson(route, init = {}) {
  const response = await fetch(`${baseUrl()}${route}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${apiToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `ForgeLink backend request failed (${response.status}).`);
  return payload;
}

function mcpInstallCommand(target = "all") {
  const script = path.resolve(__dirname, "..", "scripts", "install", "install-forgelink-mcp.ps1");
  return `pwsh -NoProfile -ExecutionPolicy Bypass -File "${script}" -Target ${target}`;
}

async function mcpPublicStatus() {
  const tokenFile = mcpTokenFile();
  const bridge = mcpServerPath();
  const status = await backendJson("/api/mcp/status").catch(() => ({ configured: false, last_test_status: "backend_unavailable" }));
  return {
    ...status,
    base_url: baseUrl(),
    token_file: tokenFile,
    token_file_present: fs.existsSync(tokenFile),
    channel_token_file: channelTokenFile("forgewire"),
    channel_token_file_present: fs.existsSync(channelTokenFile("forgewire")),
    bridge_server: bridge,
    bridge_built: fs.existsSync(bridge),
    install_commands: {
      all: mcpInstallCommand("all"),
      vscode: mcpInstallCommand("vscode"),
      claude: mcpInstallCommand("claude"),
      codex: mcpInstallCommand("codex"),
      forgewire: mcpInstallCommand("forgewire")
    }
  };
}

function publicStatus() {
  const state = settingsState();
  const settings = state.settings;
  return {
    running: Boolean(backendProcess),
    app_version: app.getVersion(),
    baseUrl: baseUrl(),
    configured: state.configured,
    credential_source: state.source,
    environment_import_available: state.environmentAvailable,
    onboarding_complete: state.onboardingComplete,
    needs_onboarding: !state.onboardingComplete,
    configured_port: settings.webhook_port,
    effective_port: effectivePort || settings.webhook_port,
    backend_restarts: backendRestarts.count,
    last_exit_code: lastExitCode,
    recovery_message: recoveryMessage,
    sms_provider_settings: smsProviderSettingsStore ? smsProviderSettingsStore.current() : undefined,
    settings: {
      account_sid: settings.account_sid,
      auth_token_configured: Boolean(settings.auth_token),
      twilio_number: settings.twilio_number,
      public_base_url: settings.public_base_url || tunnelPublicUrl,
      webhook_host: settings.webhook_host,
      webhook_port: settings.webhook_port,
      attention_policy: normalizeAttentionPolicy(settings.attention_policy)
    }
  };
}

function broadcastStatus() {
  mainWindow?.webContents.send("server-status", publicStatus());
}

async function ensureTelnyxWebhook() {
  const provider = smsProviderSettingsStore?.current().telnyx;
  if (!provider?.configured || !provider.inbound_configured) return { configured: false, reason: "telnyx_inbound_not_configured" };
  let publicBaseUrl = settingsState().settings.public_base_url || tunnelPublicUrl;
  let startedTunnel = false;
  if (!publicBaseUrl) {
    publicBaseUrl = await tunnelService().start(baseUrl());
    tunnelPublicUrl = publicBaseUrl;
    startedTunnel = true;
  }
  try {
    return await configureTelnyxWebhook(smsProviderSettingsStore.candidate(), publicBaseUrl);
  } catch (cause) {
    if (startedTunnel) { tunnelPublicUrl = ""; await tunnelService().stop(); }
    throw cause;
  }
}

async function startBackend() {
  stopBackend();
  const settings = settingsState().settings;
  const host = settings.webhook_host;
  const preferred = Number(settings.webhook_port) || 5055;
  // Detect a port conflict and fall back to a free port (PR-006).
  effectivePort = await findAvailablePort(preferred, host);
  if (effectivePort !== preferred) console.warn(`Local port ${preferred} unavailable; using ${effectivePort}.`);
  recoveryMessage = "";
  const processHandle = utilityProcess.fork(backendEntryPath(), ["--host", host, "--port", String(effectivePort)], {
    env: {
      ...process.env,
      ...(emailSettingsStore ? emailSettingsStore.backendEnv() : {}),
      ...(pushSettingsStore ? pushSettingsStore.backendEnv() : {}),
      ...(smsProviderSettingsStore ? smsProviderSettingsStore.backendEnv() : {}),
      TWILIO_ACCOUNT_SID: settings.account_sid,
      TWILIO_AUTH_TOKEN: settings.auth_token,
      TWILIO_PHONE_NUMBER: settings.twilio_number,
      TWILIO_PUBLIC_BASE_URL: settings.public_base_url || tunnelPublicUrl,
      FORGELINK_APP_VERSION: app.getVersion(),
      FORGELINK_API_TOKEN: apiToken,
      TWILIO_PHONE_API_TOKEN: apiToken
    },
    stdio: "pipe",
    serviceName: `${APP_NAME} Backend`
  });
  backendProcess = processHandle;
  processHandle.stdout?.on("data", (chunk) => console.log(`[backend] ${chunk}`.trimEnd()));
  processHandle.stderr?.on("data", (chunk) => console.error(`[backend] ${chunk}`.trimEnd()));
  processHandle.on("spawn", () => { console.log(`Backend utility process started on ${host}:${effectivePort}`); broadcastStatus(); });
  processHandle.on("exit", (code) => {
    // Only the *current* handle drives restart; replaced/intentionally-stopped
    // handles (backendProcess already nulled) never trigger a restart.
    const wasCurrent = backendProcess === processHandle;
    if (wasCurrent) backendProcess = null;
    lastExitCode = code;
    console.log(`Backend exited with code ${code}`);
    if (wasCurrent && code !== 0) {
      if (backendRestarts.allow()) {
        console.warn(`Backend crashed (code ${code}); restarting (${backendRestarts.count}/5).`);
        void startBackend();
        return;
      }
      recoveryMessage = `The local service stopped unexpectedly and could not recover automatically. Close and reopen ForgeLink. If it keeps failing, make sure port ${preferred} is free or change the local port in Settings, then start the service again.`;
    }
    broadcastStatus();
  });
}

function stopBackend() {
  const processHandle = backendProcess;
  backendProcess = null;
  if (processHandle && !processHandle.killed) processHandle.kill();
  broadcastStatus();
}

function backendIsReady() {
  return new Promise((resolve) => {
    const request = http.get(`${baseUrl()}/health`, { headers: { Authorization: `Bearer ${apiToken}` } }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await backendIsReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 760,
    minHeight: 620,
    title: APP_NAME,
    backgroundColor: "#0f1115",
    icon: path.join(__dirname, "assets", "icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

ipcMain.handle("notify", (_, payload = {}) => {
  const decision = evaluateAttention(settingsState().settings.attention_policy, payload);
  if (decision.notify && Notification.isSupported()) {
    new Notification({ title: decision.title || APP_NAME, body: decision.body || "" }).show();
  }
  return decision;
});

ipcMain.handle("open-url", (_, url) => {
  if (typeof url === "string" && url.startsWith("https://")) return shell.openExternal(url);
});

ipcMain.handle("backend-connection", () => ({ baseUrl: baseUrl(), apiToken }));
ipcMain.handle("get-status", () => publicStatus());
ipcMain.handle("attention-policy", () => normalizeAttentionPolicy(settingsState().settings.attention_policy));
ipcMain.handle("attention-policy-save", (_, policy = {}) => {
  const state = settingsStore.persistAttentionPolicy(policy);
  broadcastStatus();
  return normalizeAttentionPolicy(state.settings.attention_policy);
});
ipcMain.handle("start-server", async (_, update = {}) => {
  const current = settingsState().settings;
  const candidate = { ...current, ...update, auth_token: update.auth_token || current.auth_token };
  const validation = await validateTwilioCredentials(candidate);
  settingsStore.persist(validation.settings);
  smsProviderSettingsStore.select("twilio");
  await startBackend();
  let ready = await waitForBackend();
  if (!ready) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  // Auto-provision a public webhook unless the operator set one manually.
  if (!validation.settings.public_base_url) {
    try {
      const url = await tunnelService().start(baseUrl());
      await configureNumberWebhook(validation.settings, url);
      tunnelPublicUrl = url;
      await startBackend(); // restart so the backend sees TWILIO_PUBLIC_BASE_URL for outbound status callbacks
      ready = await waitForBackend();
      if (!ready) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
      console.log("Automatic public webhook configured.");
    } catch (cause) {
      tunnelPublicUrl = "";
      await tunnelService().stop();
      console.error(`Automatic webhook setup failed; outbound messaging still works: ${cause instanceof Error ? cause.message : cause}`);
    }
  } else {
    tunnelPublicUrl = "";
    await tunnelService().stop();
  }
  broadcastStatus();
  return { ...publicStatus(), validation: { account_name: validation.account_name, account_status: validation.account_status, phone_number: validation.phone_number } };
});
ipcMain.handle("validate-settings", async (_, update = {}) => {
  const current = settingsState().settings;
  const validation = await validateTwilioCredentials({ ...current, ...update, auth_token: update.auth_token || current.auth_token });
  return { account_name: validation.account_name, account_status: validation.account_status, phone_number: validation.phone_number };
});
ipcMain.handle("import-environment", async () => {
  const candidate = settingsState().settings;
  const validation = await validateTwilioCredentials(candidate);
  settingsStore.importEnvironment();
  smsProviderSettingsStore.select("twilio");
  await startBackend();
  if (!(await waitForBackend())) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  return { ...publicStatus(), validation: { account_name: validation.account_name, account_status: validation.account_status, phone_number: validation.phone_number } };
});
ipcMain.handle("remove-credentials", async () => {
  settingsStore.removeCredentials();
  if (smsProviderSettingsStore.current().preferred_provider === "twilio") smsProviderSettingsStore.select("none");
  await startBackend();
  await waitForBackend();
  return publicStatus();
});

// First-class Telnyx SMS/MMS settings (work item 035). Secrets stay in the main
// process and OS-backed encrypted storage. Validation is read-only; saving is the
// operator action that may configure the selected messaging profile webhook.
ipcMain.handle("sms-provider-settings-get", () => smsProviderSettingsStore.current());
ipcMain.handle("telnyx-settings-validate", async (_event, values = {}) => {
  return validateTelnyxSettings(smsProviderSettingsStore.candidate(values || {}));
});
ipcMain.handle("telnyx-settings-save", async (_event, values = {}) => {
  const candidate = smsProviderSettingsStore.candidate(values || {});
  const validation = await validateTelnyxSettings(candidate);
  const result = smsProviderSettingsStore.persist(values || {});
  await startBackend();
  if (!(await waitForBackend())) throw new Error(`Local service did not become ready at ${baseUrl()}.`);

  try {
    const webhook = await ensureTelnyxWebhook();
    broadcastStatus();
    return { ...result, validation, webhook };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Telnyx settings were saved, but automatic webhook setup failed. ${detail}`);
  }
});
ipcMain.handle("sms-provider-select", async (_event, provider) => {
  if (provider === "twilio" && !settingsState().configured) throw new Error("Configure Twilio before selecting it.");
  const result = smsProviderSettingsStore.select(provider);
  await startBackend();
  await waitForBackend();
  broadcastStatus();
  return result;
});
ipcMain.handle("telnyx-settings-remove", async () => {
  const result = smsProviderSettingsStore.removeTelnyx();
  await startBackend();
  await waitForBackend();
  broadcastStatus();
  return result;
});
// Email channel credentials (work item 018, EMAIL-002): stored OS-encrypted in the
// main process and applied by restarting the backend so the new env takes effect.
// The renderer only ever receives the redacted view (never the password/secrets).
ipcMain.handle("email-settings-get", () => emailSettingsStore.current());
ipcMain.handle("email-settings-save", async (_event, values = {}) => {
  const result = emailSettingsStore.persist(values || {});
  await startBackend();
  await waitForBackend();
  return result;
});
ipcMain.handle("email-settings-remove", async () => {
  const result = emailSettingsStore.remove();
  await startBackend();
  await waitForBackend();
  return result;
});

// Push channel credentials (work item 019, PUSH-003): topic + token stored
// OS-encrypted in the main process and applied by restarting the backend so the new
// env takes effect. The renderer only ever receives the redacted view (never the
// topic or token).
ipcMain.handle("push-settings-get", () => pushSettingsStore.current());
ipcMain.handle("push-settings-save", async (_event, values = {}) => {
  const result = pushSettingsStore.persist(values || {});
  await startBackend();
  await waitForBackend();
  return result;
});
ipcMain.handle("push-settings-remove", async () => {
  const result = pushSettingsStore.remove();
  await startBackend();
  await waitForBackend();
  return result;
});
ipcMain.handle("start-local-only", async (_, update = {}) => {
  settingsStore.startLocalOnly(update);
  smsProviderSettingsStore.select("none");
  if (!smsProviderSettingsStore.current().telnyx.inbound_configured) {
    tunnelPublicUrl = "";
    await tunnelService().stop();
  }
  await startBackend();
  if (!(await waitForBackend())) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  broadcastStatus();
  return publicStatus();
});
ipcMain.handle("start-service", async () => {
  await startBackend();
  if (!(await waitForBackend())) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  broadcastStatus();
  return publicStatus();
});
ipcMain.handle("stop-server", () => {
  stopBackend();
  tunnelPublicUrl = "";
  void tunnelService().stop();
  return publicStatus();
});
ipcMain.handle("mcp-status", () => mcpPublicStatus());
ipcMain.handle("mcp-create-token", async () => {
  const result = await backendJson("/api/mcp/token", { method: "POST" });
  const tokenFile = mcpTokenFile();
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, result.token, { mode: 0o600 });
  return mcpPublicStatus();
});
ipcMain.handle("mcp-revoke-token", async () => {
  const result = await backendJson("/api/mcp/token/revoke", { method: "POST" });
  try { fs.unlinkSync(mcpTokenFile()); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...(await mcpPublicStatus()), status: result.status };
});
ipcMain.handle("mcp-test-message", async () => {
  await backendJson("/api/mcp/test-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: "forgewire" }) });
  return mcpPublicStatus();
});
ipcMain.handle("agent-channels", async () => {
  const channels = await backendJson("/api/agent-channels");
  return channels.map((channel) => ({ ...channel, token_file: channelTokenFile(channel.channel_id), token_file_present: fs.existsSync(channelTokenFile(channel.channel_id)) }));
});
ipcMain.handle("agent-channel-create", async (_, payload = {}) => {
  const channelId = String(payload.channel_id || "forgewire");
  const result = await backendJson("/api/agent-channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: channelId, label: String(payload.label || channelId) }) });
  const file = channelTokenFile(result.channel.channel_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, result.token, { mode: 0o600 });
  return { ...result.channel, token_file: file, token_file_present: true };
});
ipcMain.handle("agent-channel-rotate", async (_, channelId = "forgewire") => {
  const result = await backendJson(`/api/agent-channels/${encodeURIComponent(String(channelId))}/token`, { method: "POST" });
  const file = channelTokenFile(result.channel.channel_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, result.token, { mode: 0o600 });
  return { ...result.channel, token_file: file, token_file_present: true };
});
ipcMain.handle("agent-channel-revoke", async (_, channelId = "forgewire") => {
  const result = await backendJson(`/api/agent-channels/${encodeURIComponent(String(channelId))}/revoke`, { method: "POST" });
  try { fs.unlinkSync(channelTokenFile(result.channel.channel_id)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...result.channel, token_file: channelTokenFile(result.channel.channel_id), token_file_present: false };
});
ipcMain.handle("agent-channel-enabled", async (_, channelId = "forgewire", enabled = true) => {
  const result = await backendJson(`/api/agent-channels/${encodeURIComponent(String(channelId))}/${enabled ? "enable" : "disable"}`, { method: "POST" });
  return { ...result.channel, token_file: channelTokenFile(result.channel.channel_id), token_file_present: fs.existsSync(channelTokenFile(result.channel.channel_id)) };
});
function localIntegrationView(integration) {
  const file = localIntegrationTokenFile(integration.id);
  return { ...integration, token_file: file, token_file_present: fs.existsSync(file) };
}
ipcMain.handle("local-integrations", async () => (await backendJson("/api/local-integrations")).map(localIntegrationView));
ipcMain.handle("local-integration-create", async (_, payload = {}) => {
  const result = await backendJson("/api/local-integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integration_id: payload.integration_id, label: payload.label, scopes: payload.scopes }) });
  const file = localIntegrationTokenFile(result.integration.id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, result.token, { mode: 0o600 }); return localIntegrationView(result.integration);
});
ipcMain.handle("local-integration-update", async (_, integrationId, payload = {}) => localIntegrationView((await backendJson(`/api/local-integrations/${encodeURIComponent(String(integrationId))}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).integration));
ipcMain.handle("local-integration-rotate", async (_, integrationId) => {
  const result = await backendJson(`/api/local-integrations/${encodeURIComponent(String(integrationId))}/rotate`, { method: "POST" }); const file = localIntegrationTokenFile(result.integration.id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, result.token, { mode: 0o600 }); return localIntegrationView(result.integration);
});
ipcMain.handle("local-integration-revoke", async (_, integrationId) => {
  const result = await backendJson(`/api/local-integrations/${encodeURIComponent(String(integrationId))}/revoke`, { method: "POST" }); const file = localIntegrationTokenFile(result.integration.id); try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; } return localIntegrationView(result.integration);
});
ipcMain.handle("local-integration-enabled", async (_, integrationId, enabled = true) => localIntegrationView((await backendJson(`/api/local-integrations/${encodeURIComponent(String(integrationId))}/${enabled ? "enable" : "disable"}`, { method: "POST" })).integration));
ipcMain.handle("local-integration-test", async (_, integrationId) => {
  const id = String(integrationId); const file = localIntegrationTokenFile(id); const token = fs.readFileSync(file, "utf8").trim();
  const response = await fetch(`${baseUrl()}/local-integrations/${encodeURIComponent(id)}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-ForgeLink-Local-Token": token }, body: JSON.stringify({ schema_version: 1, event_id: `desktop-test-${Date.now()}`, event_type: "agent_message", occurred_at: new Date().toISOString(), payload: { title: "Local integration test", body: "Synthetic local integration test event.", urgency: "low" } }) });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || `Local integration test failed (${response.status}).`); }
  const integrations = await backendJson("/api/local-integrations"); return localIntegrationView(integrations.find((item) => item.id === id));
});

// Single-instance: a second launch focuses the first window and never starts a
// competing backend (PR-010). Must run before whenReady so the second process
// exits before it can fork a backend.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  settingsStore = createSettingsStore({
    fs,
    path,
    safeStorage,
    env: process.env,
    userData: app.getPath("userData"),
    legacyUserData: path.join(app.getPath("appData"), "Twilio Phone")
  });
  settingsStore.load();
  emailSettingsStore = createEmailSettingsStore({ fs, path, safeStorage, userData: app.getPath("userData") });
  try { emailSettingsStore.load(); } catch (error) { console.error(`Email settings load failed: ${error}`); }
  pushSettingsStore = createPushSettingsStore({ fs, path, safeStorage, userData: app.getPath("userData") });
  try { pushSettingsStore.load(); } catch (error) { console.error(`Push settings load failed: ${error}`); }
  smsProviderSettingsStore = createSmsProviderSettingsStore({
    fs,
    path,
    safeStorage,
    env: process.env,
    userData: app.getPath("userData"),
    twilioConfigured: () => settingsState().configured
  });
  try { smsProviderSettingsStore.load(); } catch (error) { console.error(`SMS provider settings load failed: ${error}`); }
  if (!(await backendIsReady())) await startBackend();
  const ready = await waitForBackend();
  if (!ready) console.error(`Backend did not become ready at ${baseUrl()}`);
  if (ready) {
    try { await ensureTelnyxWebhook(); }
    catch (error) { console.error(`Telnyx webhook recovery failed; outbound messaging remains available: ${error instanceof Error ? error.message : error}`); }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Auto-update (PR-014): only in a packaged build, operator-disableable, and
  // failure-tolerant (no published feed / offline must never crash the app).
  if (shouldAutoUpdate({ isPackaged: app.isPackaged, env: process.env })) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      autoUpdater.on("error", (error) => console.error(`[updater] ${error}`));
      autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error(`[updater] ${error}`));
    } catch (error) {
      console.error(`[updater] unavailable: ${error}`);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBackend();
  if (tunnel) void tunnel.stop();
});
