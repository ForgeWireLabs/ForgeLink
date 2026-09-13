const { fork, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Browser-hosted fallback for the public README visual baseline. It reuses the
// same renderer bundle and synthetic database seed as visual-smoke.js, but uses
// an installed Chrome binary when the Electron runtime is not available locally.
const host = "127.0.0.1";
const port = 5275;
const baseUrl = `http://${host}:${port}`;
const apiToken = "visual-smoke-browser-token";
const projectRoot = path.join(__dirname, "..", "..");
const visualData = path.join(projectRoot, ".visual-smoke-data");
const outputDirectory = path.join(projectRoot, "Electron", "dist");
const assetsDirectory = path.join(projectRoot, "assets", "readme");
const hostFile = path.join(outputDirectory, "visual-smoke-host.html");
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

async function seedDatabase() {
  await fs.rm(visualData, { recursive: true, force: true });
  const { PhoneDatabase } = require(path.join(projectRoot, "Electron", "backend-dist", "database.js"));
  const previewDatabase = new PhoneDatabase(path.join(visualData, "phone.sqlite3"));
  const contactId = previewDatabase.upsertContact("Dana Rivers (sample)", "+15551234567");
  previewDatabase.updateContact(contactId, { relationship: "trusted", trust_level: "trusted", tags: "sample" });
  previewDatabase.addContactPoint(contactId, "handle", "fabric", "agent", false);
  const pending = previewDatabase.createPendingMessage("local-preview", "+15551234567", "This message could not be delivered yet. (sample)", []);
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
  previewDatabase.addAgentMessage({
    id: "agent-preview",
    channel_id: "forgewire",
    source: "fabric",
    kind: "approval_request",
    urgency: "urgent",
    title: "Deploy approval (sample)",
    body: "Synthetic approval request for a staging deploy.",
    actions: [{ id: "approve", label: "Approve" }],
    created_at: new Date().toISOString()
  });
  const signalSource = previewDatabase.upsertSignalSubscription({ title: "ForgeWire Signals", url: "https://example.com/feed.xml", fetch_interval_minutes: 60, retention_days: 30 });
  previewDatabase.addSignalItem({ subscription_id: signalSource.id, external_id: "preview-signal", title: "Build lane is ready", url: "https://example.com/build", summary: "A release candidate is available for review without entering the message queue.", author: "ForgeWire", published_at: new Date().toISOString() });
  previewDatabase.markSignalFetch(signalSource.id, "ok");
  previewDatabase.close();
}

function bridgeScript() {
  const status = () => ({
    running: true,
    baseUrl,
    configured: false,
    credential_source: "none",
    environment_import_available: false,
    onboarding_complete: true,
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
  });
  const channel = () => ({
    channel_id: "forgewire",
    label: "ForgeWire Fabric",
    enabled: true,
    configured: true,
    created_at: "synthetic",
    rotated_at: "synthetic",
    revoked_at: null,
    last_used_at: null,
    last_rejected_at: null,
    rejection_count: 0,
    rate_limited_count: 0,
    token_file: "",
    token_file_present: false
  });
  const mcp = {
    configured: false,
    created_at: null,
    rotated_at: null,
    revoked_at: null,
    last_used_at: null,
    last_test_at: null,
    last_test_status: null,
    token_file: "",
    token_file_present: false,
    bridge_server: "",
    bridge_built: false,
    base_url: baseUrl,
    install_commands: {}
  };
  return `
    const forgeLinkStatus = ${JSON.stringify(status())};
    const forgeLinkAttention = ${JSON.stringify(attentionPolicy)};
    const forgeLinkBaseUrl = ${JSON.stringify(baseUrl)};
    const forgeLinkApiToken = ${JSON.stringify(apiToken)};
    const forgeLinkNoop = async () => undefined;
    window.forgeLinkShell = {
      notify: forgeLinkNoop,
      notifyEvent: async () => ({ notify: false, reason: "browser-preview" }),
      attentionPolicy: async () => forgeLinkAttention,
      saveAttentionPolicy: async (policy) => Object.assign(forgeLinkAttention, policy || {}),
      openExternal: forgeLinkNoop,
      backendConnection: async () => ({ baseUrl: forgeLinkBaseUrl, apiToken: forgeLinkApiToken }),
      getStatus: async () => forgeLinkStatus,
      validateSettings: async () => ({ account_name: "Preview account", account_status: "active", phone_number: "+15551234567" }),
      startServer: async () => forgeLinkStatus,
      startLocalOnly: async () => forgeLinkStatus,
      startService: async () => forgeLinkStatus,
      importEnvironment: async () => forgeLinkStatus,
      removeCredentials: async () => forgeLinkStatus,
      smsProviderSettings: async () => undefined,
      validateTelnyxSettings: async () => ({}),
      saveTelnyxSettings: async () => undefined,
      selectSmsProvider: async () => undefined,
      removeTelnyxSettings: async () => undefined,
      stopServer: async () => Object.assign({}, forgeLinkStatus, { running: false }),
      mcpStatus: async () => (${JSON.stringify(mcp)}),
      createMcpToken: async () => (${JSON.stringify(mcp)}),
      revokeMcpToken: async () => (${JSON.stringify(mcp)}),
      testMcpBridge: async () => (${JSON.stringify(mcp)}),
      agentChannels: async () => [(${channel.toString()})()],
      createAgentChannel: async () => (${channel.toString()})(),
      rotateAgentChannel: async () => (${channel.toString()})(),
      revokeAgentChannel: async () => Object.assign((${channel.toString()})(), { configured: false }),
      setAgentChannelEnabled: async (_id, enabled) => Object.assign((${channel.toString()})(), { enabled }),
      localIntegrations: async () => [],
      createLocalIntegration: forgeLinkNoop,
      updateLocalIntegration: forgeLinkNoop,
      rotateLocalIntegration: forgeLinkNoop,
      revokeLocalIntegration: forgeLinkNoop,
      setLocalIntegrationEnabled: forgeLinkNoop,
      testLocalIntegration: forgeLinkNoop,
      emailSettings: async () => undefined,
      saveEmailSettings: async () => undefined,
      removeEmailSettings: async () => undefined,
      pushSettings: async () => undefined,
      savePushSettings: async () => undefined,
      removePushSettings: async () => undefined,
      pairingStatus: async () => undefined,
      nodeLinkStatus: async () => undefined,
      desktopLinkedNodeStatus: async () => undefined,
      onServerStatus: () => undefined
    };
    window.addEventListener("load", () => {
      const surface = new URLSearchParams(window.location.search).get("surface");
      if (!surface) return;
      const clickSurface = () => {
        const button = document.querySelector('button[aria-label="' + surface + '"]');
        if (button) button.click();
        else setTimeout(clickSurface, 100);
      };
      setTimeout(clickSurface, 1400);
    });
  `;
}

async function writeHostFile() {
  await fs.mkdir(outputDirectory, { recursive: true });
  const rendererDirectory = path.join(projectRoot, "Electron", "renderer");
  const appScript = pathToFileURL(path.join(rendererDirectory, "app.js")).href;
  const styles = pathToFileURL(path.join(rendererDirectory, "styles.css")).href;
  await fs.writeFile(hostFile, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${styles}"><script>${bridgeScript()}</script></head><body><div id="app"></div><script src="${appScript}" defer></script></body></html>`);
}

function chromePath() {
  return process.env.FORGELINK_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
}

function captureSurface(surface, file) {
  return new Promise((resolve, reject) => {
    const profile = path.join(os.tmpdir(), `forgelink-visual-chrome-${process.pid}-${surface.toLowerCase()}`);
    const output = path.join(outputDirectory, file);
    const url = `${pathToFileURL(hostFile).href}?surface=${encodeURIComponent(surface)}`;
    const chrome = spawn(chromePath(), [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--disable-web-security",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--allow-file-access-from-files",
      `--user-data-dir=${profile}`,
      "--window-size=1100,900",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=8000",
      `--screenshot=${output}`,
      url
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    chrome.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    chrome.on("error", reject);
    chrome.on("close", async (code) => {
      await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
      if (code !== 0) return reject(new Error(`Chrome failed for ${surface} (${code}): ${stderr}`));
      try {
        const stat = await fs.stat(output);
        if (!stat.size) throw new Error("empty screenshot");
        console.log(output);
        resolve();
      } catch (error) {
        reject(new Error(`Chrome did not create ${output}: ${error.message}`));
      }
    });
  });
}

function composeOverview() {
  return new Promise(async (resolve, reject) => {
    const overviewHost = path.join(outputDirectory, "visual-smoke-overview.html");
    const overviewOutput = path.join(outputDirectory, "forgelink-cockpit-overview.png");
    const imagePath = (file) => pathToFileURL(path.join(outputDirectory, file)).href;
    await fs.writeFile(overviewHost, `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 2248px; height: 1848px; overflow: hidden; }
      body { padding: 16px; display: grid; grid-template-columns: 1100px 1100px; grid-template-rows: 900px 900px; gap: 16px; background: #090b10; }
      img { display: block; width: 1100px; height: 900px; }
    </style></head><body>
      <img src="${imagePath("ui-cockpit-decisions.png")}" alt="Decisions cockpit">
      <img src="${imagePath("ui-cockpit-people.png")}" alt="People cockpit">
      <img src="${imagePath("ui-cockpit-agents.png")}" alt="Agents cockpit">
      <img src="${imagePath("ui-cockpit-channels.png")}" alt="Channels cockpit">
    </body></html>`);
    const profile = path.join(os.tmpdir(), `forgelink-visual-chrome-${process.pid}-overview`);
    const url = pathToFileURL(overviewHost).href;
    const chrome = spawn(chromePath(), [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
      `--user-data-dir=${profile}`,
      "--window-size=2248,1848",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1200",
      `--screenshot=${overviewOutput}`,
      url
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    chrome.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    chrome.on("error", reject);
    chrome.on("close", async (code) => {
      await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
      if (code !== 0) return reject(new Error(`Chrome failed while composing overview (${code}): ${stderr}`));
      try {
        const stat = await fs.stat(overviewOutput);
        if (!stat.size) throw new Error("empty overview screenshot");
        await fs.mkdir(assetsDirectory, { recursive: true });
        await fs.copyFile(path.join(outputDirectory, "ui-cockpit-decisions.png"), path.join(assetsDirectory, "forgelink-cockpit-hero.png"));
        await fs.copyFile(overviewOutput, path.join(assetsDirectory, "forgelink-cockpit-overview.png"));
        console.log(path.join(assetsDirectory, "forgelink-cockpit-hero.png"));
        console.log(path.join(assetsDirectory, "forgelink-cockpit-overview.png"));
        resolve();
      } catch (error) {
        reject(new Error(`Chrome did not create ${overviewOutput}: ${error.message}`));
      }
    });
  });
}

async function main() {
  await seedDatabase();
  backend = fork(path.join(projectRoot, "Electron", "backend-dist", "index.js"), ["--host", host, "--port", String(port)], {
    env: { ...process.env, FORGELINK_DATA_DIR: visualData, FORGELINK_API_TOKEN: apiToken },
    stdio: "ignore"
  });
  await waitForBackend();
  await writeHostFile();
  await captureSurface("Decisions", "ui-cockpit-decisions.png");
  await captureSurface("People", "ui-cockpit-people.png");
  await captureSurface("Agents", "ui-cockpit-agents.png");
  await captureSurface("Channels", "ui-cockpit-channels.png");
  await composeOverview();
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    backend?.kill();
  });
