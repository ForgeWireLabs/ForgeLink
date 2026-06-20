const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const host = "127.0.0.1";
const port = 5100 + Math.floor(Math.random() * 800);
const baseUrl = `http://${host}:${port}`;
const apiToken = randomBytes(32).toString("base64url");
const attentionPolicy = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_allow_urgent: false,
  redact_notification_bodies: true,
  sms_notifications: "all",
  agent_notifications: "high_and_urgent",
  signal_notifications: "off",
  system_notifications: "all",
  muted_sources: []
};
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
  const contactId = previewDatabase.upsertContact("Grace Hopper", "+15551234567");
  previewDatabase.addContactPoint(contactId, "handle", "fabric", "agent", false);
  const pending = previewDatabase.createPendingMessage("local-preview", "+15551234567", "This message could not be delivered yet.", []);
  previewDatabase.markMessageFailed(pending.id, "Preview failure");
  previewDatabase.saveDraft(pending.thread_id, "A restart-safe draft");
  previewDatabase.createCall({
    localCallId: "call-preview",
    providerKind: "voice_edge",
    providerName: "twilio",
    providerCallId: "CA-PREVIEW",
    direction: "outbound",
    from: "+15550001111",
    to: "+15551234567",
    contactId,
    status: "ringing",
    startedAt: new Date().toISOString()
  });
  previewDatabase.addAgentMessage({ id: "agent-preview", channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "urgent", title: "Deploy approval", body: "Private deployment approval body", actions: [{ id: "approve", label: "Approve" }], created_at: new Date().toISOString() });
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
      webhook_port: port,
      attention_policy: attentionPolicy
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
  ipcMain.handle("attention-policy", () => attentionPolicy);
  ipcMain.handle("attention-policy-save", (_, policy) => Object.assign(attentionPolicy, policy || {}));
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
  const settingsRect = await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="Settings"]');
      if (!button) throw new Error("Settings navigation button was not found.");
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()
  `);
  window.webContents.sendInputEvent({ type: "mouseDown", x: settingsRect.x, y: settingsRect.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: settingsRect.x, y: settingsRect.y, button: "left", clickCount: 1 });
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        if ([...document.querySelectorAll("h1")].some((heading) => heading.textContent === "Settings")) resolve(true);
        else if (Date.now() > deadline) reject(new Error("Settings view did not open."));
        else setTimeout(check, 100);
      };
      check();
    })
  `);
  await window.webContents.executeJavaScript(`
    (() => {
      const heading = [...document.querySelectorAll("h2")].find((item) => item.textContent === "Attention policy");
      if (!heading) throw new Error("Attention policy section was not found.");
      const scroller = document.querySelector(".page-panel") || document.scrollingElement;
      scroller.scrollTop = heading.getBoundingClientRect().top + scroller.scrollTop - 220;
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await window.webContents.capturePage();
  const output = path.join(projectRoot, "Electron", "dist", "ui-preview.png");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  console.log(output);
  const callsRect = await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="Calls"]');
      if (!button) throw new Error("Calls navigation button was not found.");
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()
  `);
  window.webContents.sendInputEvent({ type: "mouseDown", x: callsRect.x, y: callsRect.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: callsRect.x, y: callsRect.y, button: "left", clickCount: 1 });
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        if ([...document.querySelectorAll("h1")].some((heading) => heading.textContent === "Calls")) resolve(true);
        else if (Date.now() > deadline) reject(new Error("Calls view did not open."));
        else setTimeout(check, 100);
      };
      check();
    })
  `);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const callsImage = await window.webContents.capturePage();
  const callsOutput = path.join(projectRoot, "Electron", "dist", "ui-calls-preview.png");
  await fs.writeFile(callsOutput, callsImage.toPNG());
  console.log(callsOutput);
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="Contacts"]');
      if (!button) throw new Error("Contacts navigation button was not found.");
      button.click();
    })()
  `);
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        if ([...document.querySelectorAll("h1")].some((heading) => heading.textContent === "Contacts")) resolve(true);
        else if (Date.now() > deadline) reject(new Error("Contacts view did not open."));
        else setTimeout(check, 100);
      };
      check();
    })
  `);
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="Edit Grace Hopper"]');
      if (!button) throw new Error("Grace Hopper edit button was not found.");
      button.click();
    })()
  `);
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        const modalReady = [...document.querySelectorAll("h2")].some((heading) => heading.textContent === "Edit contact");
        const timelineReady = [...document.querySelectorAll("h3")].some((heading) => heading.textContent === "Contact timeline");
        const timelineRows = document.querySelectorAll(".contact-timeline-row").length;
        const emptyVisible = document.body.textContent.includes("No timeline events yet.");
        if (modalReady && timelineReady && timelineRows > 0 && !emptyVisible) resolve(true);
        else if (Date.now() > deadline) reject(new Error("Contact timeline did not render."));
        else setTimeout(check, 100);
      };
      check();
    })
  `);
  await window.webContents.executeJavaScript(`
    (() => {
      const heading = [...document.querySelectorAll("h3")].find((item) => item.textContent === "Contact timeline");
      if (!heading) throw new Error("Contact timeline section was not found.");
      heading.scrollIntoView({ block: "center" });
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const timelineImage = await window.webContents.capturePage();
  const timelineOutput = path.join(projectRoot, "Electron", "dist", "ui-contact-timeline-preview.png");
  await fs.writeFile(timelineOutput, timelineImage.toPNG());
  console.log(timelineOutput);
  app.quit();
});

app.on("before-quit", () => backend?.kill());
