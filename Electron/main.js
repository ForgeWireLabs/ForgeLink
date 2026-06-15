const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { createSettingsStore, validateTwilioCredentials } = require("./onboarding");

const APP_NAME = "ForgeLink";
const BACKEND_ENTRY = path.join(__dirname, "backend-dist", "index.js");
const apiToken = randomBytes(32).toString("base64url");

let backendProcess = null;
let mainWindow = null;
let settingsStore = null;

function settingsState() {
  return settingsStore.current();
}

function baseUrl() {
  const settings = settingsState().settings;
  return `http://${settings.webhook_host}:${settings.webhook_port}`;
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
      public_base_url: settings.public_base_url,
      webhook_host: settings.webhook_host,
      webhook_port: settings.webhook_port
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
      TWILIO_PUBLIC_BASE_URL: settings.public_base_url,
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
  if (Notification.isSupported()) {
    new Notification({ title: payload.title || APP_NAME, body: payload.body || "" }).show();
  }
});

ipcMain.handle("open-url", (_, url) => {
  if (typeof url === "string" && url.startsWith("https://")) return shell.openExternal(url);
});

ipcMain.handle("backend-connection", () => ({ baseUrl: baseUrl(), apiToken }));
ipcMain.handle("get-status", () => publicStatus());
ipcMain.handle("start-server", async (_, update = {}) => {
  const current = settingsState().settings;
  const candidate = { ...current, ...update, auth_token: update.auth_token || current.auth_token };
  const validation = await validateTwilioCredentials(candidate);
  settingsStore.persist(validation.settings);
  startBackend();
  const ready = await waitForBackend();
  if (!ready) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
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
  return publicStatus();
});

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
});
