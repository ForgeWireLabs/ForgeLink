const { app, BrowserWindow, shell, ipcMain, Notification, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const Store = require("electron-store");

const store = new Store({ name: "twiliophone" });

// ---- Python integration -----------------------------------------------------
const PY_ENTRY = path.join(__dirname, "..", "python", process.env.APP_MAIN || "twilio_phone.py");
const PY_HOST = store.get("webhook_host", "127.0.0.1");
const PY_PORT = store.get("webhook_port", 5055);
const BASE_URL = `http://${PY_HOST}:${PY_PORT}`;

let pyProc = null;
let win = null;

function startPython() {
  // Run your backend in headless mode (webhooks/uploads/api/token/etc)
  const py = process.env.PYTHON || "python3";
  pyProc = spawn(py, [PY_ENTRY, "--headless"], {
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: "inherit"
  });
  pyProc.on("exit", (code) => console.log("[python] exited", code));
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
    if (details.url.startsWith(BASE_URL)) {
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
  win.webContents.send("open-voice", `${BASE_URL}/voice`);
});

ipcMain.handle("open-url", (_, url) => {
  shell.openExternal(url);
});

// Persist settings pushed by renderer (also inform Python on restart)
ipcMain.handle("set-settings", (_, cfg) => {
  if (!cfg || typeof cfg !== "object") return;
  Object.entries(cfg).forEach(([k, v]) => store.set(k, v));
});

app.whenReady().then(() => {
  startPython();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { try { if (pyProc) pyProc.kill(); } catch(_){} });
