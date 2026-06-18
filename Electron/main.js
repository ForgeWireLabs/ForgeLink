const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { evaluateAttention, normalizeAttentionPolicy } = require("./attention");
const { createSettingsStore, validateTwilioCredentials, configureNumberWebhook } = require("./onboarding");
const { createTunnelManager } = require("./tunnel");

const APP_NAME = "ForgeLink";
const BACKEND_ENTRY = path.join(__dirname, "backend-dist", "index.js");
const apiToken = randomBytes(32).toString("base64url");

let backendProcess = null;
let mainWindow = null;
let settingsStore = null;
let tunnel = null;
let tunnelPublicUrl = "";

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
  return `http://${settings.webhook_host}:${settings.webhook_port}`;
}

function mcpTokenFile() {
  return path.join(os.homedir(), ".forgelink", "api.token");
}

function channelTokenFile(channelId = "forgewire") {
  return path.join(os.homedir(), ".forgelink", "channels", `${channelId}.token`);
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
    baseUrl: baseUrl(),
    configured: state.configured,
    credential_source: state.source,
    environment_import_available: state.environmentAvailable,
    needs_onboarding: !state.configured,
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

function startBackend() {
  stopBackend();
  const settings = settingsState().settings;
  const processHandle = utilityProcess.fork(BACKEND_ENTRY, ["--host", settings.webhook_host, "--port", String(settings.webhook_port)], {
    env: {
      ...process.env,
      TWILIO_ACCOUNT_SID: settings.account_sid,
      TWILIO_AUTH_TOKEN: settings.auth_token,
      TWILIO_PHONE_NUMBER: settings.twilio_number,
      TWILIO_PUBLIC_BASE_URL: settings.public_base_url || tunnelPublicUrl,
      FORGELINK_API_TOKEN: apiToken,
      TWILIO_PHONE_API_TOKEN: apiToken
    },
    stdio: "pipe",
    serviceName: `${APP_NAME} Backend`
  });
  backendProcess = processHandle;
  processHandle.stdout?.on("data", (chunk) => console.log(`[backend] ${chunk}`.trimEnd()));
  processHandle.stderr?.on("data", (chunk) => console.error(`[backend] ${chunk}`.trimEnd()));
  processHandle.on("spawn", () => { console.log("Backend utility process started"); broadcastStatus(); });
  processHandle.on("exit", (code) => {
    if (backendProcess === processHandle) backendProcess = null;
    console.log(`Backend exited with code ${code}`);
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
  startBackend();
  let ready = await waitForBackend();
  if (!ready) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  // Auto-provision a public webhook unless the operator set one manually.
  if (!validation.settings.public_base_url) {
    try {
      const url = await tunnelService().start(baseUrl());
      await configureNumberWebhook(validation.settings, url);
      tunnelPublicUrl = url;
      startBackend(); // restart so the backend sees TWILIO_PUBLIC_BASE_URL for outbound status callbacks
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
  startBackend();
  if (!(await waitForBackend())) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  return { ...publicStatus(), validation: { account_name: validation.account_name, account_status: validation.account_status, phone_number: validation.phone_number } };
});
ipcMain.handle("remove-credentials", async () => {
  settingsStore.removeCredentials();
  startBackend();
  await waitForBackend();
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
  if (!(await backendIsReady())) startBackend();
  const ready = await waitForBackend();
  if (!ready) console.error(`Backend did not become ready at ${baseUrl()}`);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBackend();
  if (tunnel) void tunnel.stop();
});
