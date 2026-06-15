const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const host = "127.0.0.1";
const port = 5100 + Math.floor(Math.random() * 800);
const baseUrl = `http://${host}:${port}`;
const apiToken = randomBytes(32).toString("base64url");
const projectRoot = path.join(__dirname, "..", "..");
const visualData = path.join(projectRoot, ".visual-smoke-data");
let backend;

function waitForBackend() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const check = () => {
      const request = http.get(`${baseUrl}/health`, { headers: { Authorization: `Bearer ${apiToken}` } }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else retry();
      });
      request.on("error", retry);
      request.setTimeout(300, () => { request.destroy(); retry(); });
    };
    const retry = () => Date.now() > deadline ? reject(new Error("Backend did not start")) : setTimeout(check, 150);
    check();
  });
}

app.whenReady().then(async () => {
  await fs.rm(visualData, { recursive: true, force: true });
  const { PhoneDatabase } = require(path.join(projectRoot, "Electron", "backend-dist", "database.js"));
  const previewDatabase = new PhoneDatabase(path.join(visualData, "phone.sqlite3"));
  const pending = previewDatabase.createPendingMessage("local-preview", "+15551234567", "This message could not be delivered yet.", []);
  previewDatabase.markMessageFailed(pending.id, "Preview failure");
  previewDatabase.saveDraft(pending.thread_id, "A restart-safe draft");
  previewDatabase.close();
  backend = utilityProcess.fork(path.join(projectRoot, "Electron", "backend-dist", "index.js"), ["--host", host, "--port", String(port)], {
    env: { ...process.env, FORGELINK_DATA_DIR: visualData, FORGELINK_API_TOKEN: apiToken },
    stdio: "pipe",
    serviceName: "ForgeLink Visual Smoke Backend"
  });

  await waitForBackend();
  ipcMain.handle("backend-connection", () => ({ baseUrl, apiToken }));
  ipcMain.handle("get-status", () => ({
    running: true,
    baseUrl,
    configured: false,
    credential_source: "none",
    environment_import_available: false,
    needs_onboarding: false,
    settings: {
      account_sid: "",
      auth_token_configured: false,
      twilio_number: "",
      public_base_url: "",
      webhook_host: host,
      webhook_port: port
    }
  }));
  ipcMain.handle("start-server", () => ({ running: true, baseUrl }));
  ipcMain.handle("validate-settings", () => ({ account_name: "Preview account", account_status: "active", phone_number: "+15551234567" }));
  ipcMain.handle("import-environment", () => ({ running: true, baseUrl }));
  ipcMain.handle("remove-credentials", () => ({ running: true, baseUrl, configured: false }));
  ipcMain.handle("stop-server", () => ({ running: false, baseUrl }));
  ipcMain.handle("notify", () => undefined);
  ipcMain.handle("open-url", () => undefined);

  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    backgroundColor: "#090b10",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(projectRoot, "Electron", "preload.js"),
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadFile(path.join(projectRoot, "Electron", "renderer", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await window.webContents.executeJavaScript("document.querySelector('.thread-row')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await window.webContents.capturePage();
  const output = path.join(projectRoot, "Electron", "dist", "ui-preview.png");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  console.log(output);
  app.quit();
});

app.on("before-quit", () => backend?.kill());
