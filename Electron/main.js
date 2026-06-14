const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const BACKEND_ENTRY = path.join(__dirname, "backend-dist", "index.js");
const DEFAULT_SETTINGS = {
  account_sid: "",
  auth_token: "",
  twilio_number: "",
  public_base_url: "",
  webhook_host: "127.0.0.1",
  webhook_port: 5055
};

let backendProcess = null;
let mainWindow = null;
let settings = { ...DEFAULT_SETTINGS };

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    settings = { ...DEFAULT_SETTINGS, ...stored };
    if (stored.auth_token_encrypted && safeStorage.isEncryptionAvailable()) {
      settings.auth_token = safeStorage.decryptString(Buffer.from(stored.auth_token_encrypted, "base64"));
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not load settings:", error.message);
  }
  settings.account_sid ||= process.env.TWILIO_ACCOUNT_SID || "";
  settings.auth_token ||= process.env.TWILIO_AUTH_TOKEN || "";
  settings.twilio_number ||= process.env.TWILIO_PHONE_NUMBER || "";
  settings.public_base_url ||= process.env.TWILIO_PUBLIC_BASE_URL || "";
  settings.webhook_host = process.env.TWILIO_PHONE_HOST || settings.webhook_host;
  settings.webhook_port = Number(process.env.TWILIO_PHONE_PORT || settings.webhook_port);
}

function saveSettings(update = {}) {
  const next = { ...settings, ...update };
  if (!update.auth_token) next.auth_token = settings.auth_token;
  next.webhook_host = String(next.webhook_host || DEFAULT_SETTINGS.webhook_host);
  next.webhook_port = Number(next.webhook_port || DEFAULT_SETTINGS.webhook_port);
  if (!new Set(["127.0.0.1", "localhost"]).has(next.webhook_host)) {
    throw new Error("Local service host must remain on loopback.");
  }
  if (!Number.isInteger(next.webhook_port) || next.webhook_port < 1024 || next.webhook_port > 65535) {
    throw new Error("Local service port must be between 1024 and 65535.");
  }
  const stored = { ...next };
  delete stored.auth_token;
  if (next.auth_token) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
    stored.auth_token_encrypted = safeStorage.encryptString(next.auth_token).toString("base64");
  }
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(stored, null, 2), { mode: 0o600 });
  settings = next;
}

function baseUrl() {
  return `http://${settings.webhook_host}:${settings.webhook_port}`;
}

function publicStatus() {
  return {
    running: Boolean(backendProcess),
    baseUrl: baseUrl(),
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
  const processHandle = utilityProcess.fork(BACKEND_ENTRY, ["--host", settings.webhook_host, "--port", String(settings.webhook_port)], {
    env: {
      ...process.env,
      TWILIO_ACCOUNT_SID: settings.account_sid,
      TWILIO_AUTH_TOKEN: settings.auth_token,
      TWILIO_PHONE_NUMBER: settings.twilio_number,
      TWILIO_PUBLIC_BASE_URL: settings.public_base_url
    },
    stdio: "pipe",
    serviceName: "Twilio Phone Backend"
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
    const request = http.get(`${baseUrl()}/health`, (response) => {
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
    title: "Twilio Phone",
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
    new Notification({ title: payload.title || "Twilio Phone", body: payload.body || "" }).show();
  }
});

ipcMain.handle("open-url", (_, url) => {
  if (typeof url === "string" && url.startsWith("https://")) return shell.openExternal(url);
});

ipcMain.handle("backend-url", () => baseUrl());
ipcMain.handle("get-status", () => publicStatus());
ipcMain.handle("start-server", async (_, update = {}) => {
  saveSettings(update);
  startBackend();
  const ready = await waitForBackend();
  if (!ready) throw new Error(`Local service did not become ready at ${baseUrl()}.`);
  broadcastStatus();
  return publicStatus();
});
ipcMain.handle("stop-server", () => {
  stopBackend();
  return publicStatus();
});

app.whenReady().then(async () => {
  loadSettings();
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
