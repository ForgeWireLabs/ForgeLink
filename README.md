# ForgeLink

ForgeLink is a private communications console for direct links, messages, and trusted channels. Today it runs as a focused Electron desktop client for Twilio SMS and MMS. Electron owns a React and TypeScript UI and launches a bundled TypeScript backend as a utility process. The backend uses Node's built-in SQLite support, so packaged builds do not require Python, Node, or native database modules.

Private loopback API routes require a random per-launch credential shared through the narrow preload bridge. Twilio webhooks use signature validation instead, and entropy-named media remains reachable for Twilio's MMS fetches.

## Requirements

- Node.js 22 or newer
- A Twilio account and phone number

## Setup

```powershell
cd Electron
npm install
npm start
```

On first launch, the app opens a setup wizard for the Twilio account SID, auth token, phone number, public webhook URL, and local service address. Use **Test connection** to confirm the account and selected Twilio number before saving. Stored auth tokens are encrypted with Electron `safeStorage` and are never returned to the renderer.

Use **Settings** to test and update the connection or remove stored credentials. If complete Twilio environment variables are present, the app can run from them and offers an explicit secure import; it does not silently persist them.

Environment variables remain supported for development and migration:

```powershell
$env:TWILIO_ACCOUNT_SID = "AC..."
$env:TWILIO_AUTH_TOKEN = "..."
$env:TWILIO_PHONE_NUMBER = "+15551234567"
$env:TWILIO_PUBLIC_BASE_URL = "https://your-public-tunnel.example"
```

The app data is stored in `%USERPROFILE%\.forgelink` by default. Override it with `FORGELINK_DATA_DIR`. Existing `%USERPROFILE%\.twilio-phone` and legacy `~/.config/TwilioPhone` data are imported on first launch only when the new ForgeLink data targets do not already exist.

The **Settings > Data safety** panel creates verified SQLite and upload backups, restores the latest managed backup, writes JSON exports, and applies message retention after making a safety backup. Backups and exports are sensitive plaintext and should be protected like the original message database.

Outbound messages are written locally before Twilio is called. Pending and failed states survive restarts, failed messages can be retried explicitly, delivery callbacks update the same local row, and conversation drafts are stored in SQLite.

## Agentic apps and MCP

ForgeLink includes a Node/TypeScript MCP bridge for external agentic apps that
need to reach a human without becoming a social feed. The bridge exposes
ForgeWire-style tools, resources, and prompts, then sends messages through the
local ForgeLink agent-channel API.

```powershell
cd mcp/forgelink-human
npm run build
```

MCP templates for VS Code/Copilot, Claude Code, Codex, and ForgeWire/Fabric live
under `install/mcp-configs/`. A PowerShell installer can build the bridge and
write app configs:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/install/install-forgelink-mcp.ps1 -Target all
```

The MCP bridge requires `FORGELINK_API_TOKEN` or `FORGELINK_API_TOKEN_FILE` and
should stay pointed at the loopback ForgeLink API.

For incoming messages, expose port `5055` through a secure tunnel and configure the Twilio messaging webhook as:

```text
https://your-public-tunnel.example/webhooks/sms
```

Set the delivery status callback to:

```text
https://your-public-tunnel.example/webhooks/status
```

## Development

```powershell
cd Electron
npm test
npm run dev
```

The supported runtime is Electron plus `Electron/backend-dist/`, built from `Electron/backend/src/`. On first launch, the backend conservatively imports legacy Twilio Phone databases and uploads directories only when the new data targets do not already exist.

The renderer source lives in `Electron/renderer/src/`. `npm run renderer:build` type-checks it and emits the packaged browser bundle at `Electron/renderer/app.js`.
