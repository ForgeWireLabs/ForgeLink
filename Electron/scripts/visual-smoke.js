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
  const signalSource = previewDatabase.upsertSignalSubscription({ title: "ForgeWire Signals", url: "https://example.com/feed.xml", fetch_interval_minutes: 60, retention_days: 30 });
  previewDatabase.addSignalItem({ subscription_id: signalSource.id, external_id: "preview-signal", title: "Build lane is ready", url: "https://example.com/build", summary: "A release candidate is available for review without entering the message queue.", author: "ForgeWire", published_at: new Date().toISOString() });
  previewDatabase.markSignalFetch(signalSource.id, "ok");
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
  const mcpStatus = (overrides = {}) => ({
    configured: true,
    created_at: new Date().toISOString(),
    rotated_at: new Date().toISOString(),
    revoked_at: null,
    last_used_at: null,
    last_test_at: new Date().toISOString(),
    last_test_status: "passed",
    token_file: path.join(process.env.USERPROFILE || process.env.HOME || projectRoot, ".forgelink", "api.token"),
    token_file_present: true,
    bridge_server: path.join(projectRoot, "mcp", "forgelink-human", "dist", "server.js"),
    bridge_built: true,
    base_url: baseUrl,
    install_commands: {
      vscode: "code --add-mcp forgelink-human",
      claude: "claude mcp add forgelink-human node mcp/forgelink-human/dist/server.js",
      codex: "codex mcp add forgelink-human -- node mcp/forgelink-human/dist/server.js",
      forgewire: "forgewire mcp add forgelink-human"
    },
    ...overrides
  });
  ipcMain.handle("mcp-status", () => mcpStatus());
  ipcMain.handle("mcp-create-token", () => mcpStatus());
  ipcMain.handle("mcp-revoke-token", () => mcpStatus({
    configured: false,
    revoked_at: new Date().toISOString(),
    token_file_present: false
  }));
  ipcMain.handle("mcp-test-message", () => mcpStatus({ last_test_status: "passed" }));
  const channelStatus = (overrides = {}) => ({
    channel_id: "forgewire",
    label: "ForgeWire Fabric",
    enabled: true,
    configured: true,
    created_at: new Date().toISOString(),
    rotated_at: new Date().toISOString(),
    revoked_at: null,
    last_used_at: null,
    last_rejected_at: null,
    rejection_count: 0,
    rate_limited_count: 0,
    token_file: path.join(process.env.USERPROFILE || process.env.HOME || projectRoot, ".forgelink", "channels", "forgewire.token"),
    token_file_present: true,
    ...overrides
  });
  ipcMain.handle("agent-channels", () => [channelStatus()]);
  ipcMain.handle("agent-channel-create", () => channelStatus());
  ipcMain.handle("agent-channel-rotate", () => channelStatus());
  ipcMain.handle("agent-channel-revoke", () => channelStatus({ configured: false, revoked_at: new Date().toISOString(), token_file_present: false }));
  ipcMain.handle("agent-channel-enabled", (_, channelId, enabled) => channelStatus({ channel_id: channelId || "forgewire", enabled: Boolean(enabled) }));
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
  const signalsRect = await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="Signals"]');
      if (!button) throw new Error("Signals navigation button was not found.");
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()
  `);
  window.webContents.sendInputEvent({ type: "mouseDown", x: signalsRect.x, y: signalsRect.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: signalsRect.x, y: signalsRect.y, button: "left", clickCount: 1 });
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        if ([...document.querySelectorAll("h1")].some((heading) => heading.textContent === "Signals")) resolve(true);
        else if (Date.now() > deadline) reject(new Error("Signals view did not open."));
        else setTimeout(check, 100);
      };
      check();
    })
  `);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await window.webContents.capturePage();
  const output = path.join(projectRoot, "Electron", "dist", "ui-preview.png");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  console.log(output);
  app.quit();
});

app.on("before-quit", () => backend?.kill());
