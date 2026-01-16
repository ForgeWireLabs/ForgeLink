const { app, BrowserWindow, shell, ipcMain, Notification, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const Store = require("electron-store");

const store = new Store({ name: "twiliophone" });

// ---- Python integration -----------------------------------------------------
const PY_ENTRY = path.join(__dirname, "..", "python", process.env.APP_MAIN || "twilio_phone.py");
const DEFAULT_SETTINGS = {
  webhook_host: "127.0.0.1",
  webhook_port: 5055,
  account_sid: "",
  auth_token: "",
  twilio_number: "",
  api_key_sid: "",
  api_key_secret: "",
  public_base_url: "",
  twiml_app_sid: ""
};

let pyProc = null;
let win = null;
let baseUrl = null;

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...store.store };
}

function persistSettings(cfg = {}) {
  const current = getSettings();
  const merged = { ...current, ...cfg };
  store.set(merged);
  return merged;
}

function stopPython() {
  if (pyProc) {
    try { pyProc.kill(); } catch (_) {}
  }
  pyProc = null;
}

function computeBaseUrl(cfg) {
  const host = cfg.webhook_host || DEFAULT_SETTINGS.webhook_host;
  const port = cfg.webhook_port || DEFAULT_SETTINGS.webhook_port;
  return `http://${host}:${port}`;
}

function broadcastStatus(extra = {}) {
  const payload = { running: Boolean(pyProc), baseUrl, settings: getSettings(), ...extra };
  if (win) {
    win.webContents.send("server-status", payload);
  }
}

function startPython(cfg = {}) {
  const merged = persistSettings(cfg);
  stopPython();
  baseUrl = computeBaseUrl(merged);
  const py = process.env.PYTHON || "python3";
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    WEBHOOK_HOST: merged.webhook_host || DEFAULT_SETTINGS.webhook_host,
    WEBHOOK_PORT: String(merged.webhook_port || DEFAULT_SETTINGS.webhook_port),
    TWILIO_ACCOUNT_SID: merged.account_sid || "",
    TWILIO_AUTH_TOKEN: merged.auth_token || "",
    TWILIO_PHONE_NUMBER: merged.twilio_number || "",
    TWILIO_API_KEY_SID: merged.api_key_sid || "",
    TWILIO_API_KEY_SECRET: merged.api_key_secret || "",
    TWILIO_PUBLIC_BASE_URL: merged.public_base_url || "",
    TWILIO_TWIML_APP_SID: merged.twiml_app_sid || ""
  };
  pyProc = spawn(py, [PY_ENTRY, "--headless"], { env, stdio: "inherit" });
  pyProc.on("exit", (code) => {
    console.log("[python] exited", code);
    pyProc = null;
    broadcastStatus({ running: false });
  });
  broadcastStatus({ running: true });
}

// ---- Window & security ------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1020,
    height: 900,
    title: "Twilio Phone",
    backgroundColor: "#111318",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Extra: allow our local Python host without CORS noise
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (baseUrl && details.url.startsWith(baseUrl)) {
      const headers = {
        ...details.responseHeaders,
        "Access-Control-Allow-Origin": ["*"],
        "Access-Control-Allow-Headers": ["*"],
        "Access-Control-Allow-Methods": ["GET,POST,PUT,DELETE,OPTIONS"]
      };
      return cb({ responseHeaders: headers });
    }
    cb({ responseHeaders: details.responseHeaders });
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

// ---- Notifications & IPC ----------------------------------------------------
ipcMain.handle("notify", (_, payload) => {
  const { title, body } = payload || {};
  const n = new Notification({ title: title || "Twilio Phone", body: body || "" });
  n.show();
});

ipcMain.handle("open-voice", () => {
  if (!win) return;
  // Open /voice inside the app
  if (!baseUrl) return;
  win.webContents.send("open-voice", `${baseUrl}/voice`);
});

ipcMain.handle("open-url", (_, url) => {
  shell.openExternal(url);
});

// Persist settings pushed by renderer (also inform Python on restart)
ipcMain.handle("set-settings", (_, cfg) => {
  if (!cfg || typeof cfg !== "object") return;
  persistSettings(cfg);
  baseUrl = computeBaseUrl(getSettings());
  broadcastStatus();
});

ipcMain.handle("get-status", () => ({ running: Boolean(pyProc), baseUrl, settings: getSettings() }));

ipcMain.handle("start-server", (_, cfg) => {
  try {
    startPython(cfg || {});
    return { ok: true };
  } catch (err) {
    console.error("Failed to start Python", err);
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("stop-server", () => {
  stopPython();
  broadcastStatus({ running: false });
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  baseUrl = computeBaseUrl(getSettings());
  broadcastStatus();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { try { if (pyProc) pyProc.kill(); } catch(_){} });
