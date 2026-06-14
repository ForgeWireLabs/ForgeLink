const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const host = "127.0.0.1";
const port = 5100 + Math.floor(Math.random() * 800);
const baseUrl = `http://${host}:${port}`;
const projectRoot = path.join(__dirname, "..", "..");
let backend;

function waitForBackend() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const check = () => {
      const request = http.get(`${baseUrl}/health`, (response) => {
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
  backend = utilityProcess.fork(path.join(projectRoot, "Electron", "backend-dist", "index.js"), ["--host", host, "--port", String(port)], {
    env: { ...process.env, TWILIO_PHONE_DATA_DIR: path.join(projectRoot, ".visual-smoke-data") },
    stdio: "pipe",
    serviceName: "Twilio Phone Visual Smoke Backend"
  });

  await waitForBackend();
  ipcMain.handle("backend-url", () => baseUrl);
  ipcMain.handle("get-status", () => ({
    running: true,
    baseUrl,
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
  const image = await window.webContents.capturePage();
  const output = path.join(projectRoot, "Electron", "dist", "ui-preview.png");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  console.log(output);
  app.quit();
});

app.on("before-quit", () => backend?.kill());
