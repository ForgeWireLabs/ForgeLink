# ForgeLink

<p align="center">
  <img src="assets/readme/forgelink-architecture.svg" alt="ForgeLink architecture diagram" width="100%">
</p>

**ForgeLink is a local-first communications and decision runtime for humans and agents.**

It is the private boundary where trusted systems ask for human attention, authority, and decisions — and where a human operator reviews, approves, denies, defers, replays, and audits what happened.

ForgeLink is not another chat feed. It is not a hosted notification relay. It is not an agent runner.

It is the governed place where a system asks, a human decides, and the outcome is recorded.

> **Agent messages are communications, not content.**

---

## Why ForgeLink Exists

Agentic systems eventually need to reach a person.

Most systems solve that with a popup, a chat window, a Slack bot, a webhook, or an approval modal bolted onto a workflow. That can work for demos, but it does not give the human a durable boundary.

It does not answer the questions that matter:

- Who is asking for attention?
- Which system, agent, tool, or workflow is responsible?
- Why is this request being made now?
- What action is being requested?
- What evidence is available?
- What authority is required?
- What happens if the human says no?
- What happens if the human does not respond?
- Which requests are allowed to interrupt?
- Which agents are muted, blocked, trusted, or on probation?
- What data leaves the local machine?
- How can the decision be replayed later?

ForgeLink treats those questions as product infrastructure.

The center is not SMS, voice, MCP, or notifications.

The center is **governed communication state**.

---

## What ForgeLink Is

ForgeLink is currently four things working together.

### 1. A local-first communications runtime

ForgeLink provides a desktop communications surface with local persistence and provider-neutral channel edges.

Current surface:

- Electron desktop app.
- React/TypeScript renderer.
- Bundled TypeScript backend.
- Local SQLite persistence using Node's built-in SQLite support.
- Provider-neutral channel architecture.
- Shared adapter conformance kit for channel providers.
- SMS/MMS through Twilio and Telnyx.
- Twilio Voice with durable call history.
- Rich contacts.
- Contact points and channel identities.
- Per-contact attention policy.
- Redaction-aware contact timeline across messages, calls, and agent requests.
- Provider-optional first run: usable local-only with no telecom provider.
- Backup, restore, export, retention, and delivery-state handling.

Channels are edges.

ForgeLink itself is the local boundary that owns message state, human attention, and operator decisions.

### 2. A human bridge for agentic apps

ForgeLink exposes a local authenticated bridge for tools and agents that need to reach a human without becoming another unmanaged feed.

Current bridge surface:

- Local authenticated agent-channel API.
- Node/TypeScript MCP bridge.
- MCP templates for Claude Code, Codex, VS Code/Copilot, ForgeWire/Fabric, and other MCP-capable tools.
- Tools for human messages, approval requests, message lookup, dismissal, action recording, and channel status.
- Resources and prompts that describe the human communication contract.
- File-backed MCP credentials that can be created, rotated, revoked, and tested from the desktop settings UI.

Agents do not write directly to the ForgeLink database.

They talk through the local API. ForgeLink remains the owner of the human boundary.

### 3. An attention policy layer

ForgeLink treats attention as something that must be governed, not harvested.

Current attention policy surface:

- Quiet hours.
- Source pause and mute controls.
- Channel pause and mute controls.
- Urgency-aware behavior.
- Redacted desktop notifications by default.
- Per-channel urgency limits.
- Trusted signal handling.
- Explicit rules for when agent messages, SMS, trusted signals, and system notices may interrupt.

Default posture:

- Trusted signals are quiet by default.
- Only high or urgent agent messages interrupt by default.
- Direct SMS notifications avoid body text by default.
- Agent notification bodies are redacted by default.
- Notification text is scrubbed for common sensitive values such as account IDs, ForgeLink tokens, phone-number-like values, and URLs.

ForgeLink should help systems reach a person without turning human attention into an attention market.

### 4. An agent-human governance layer

ForgeLink now includes a working governance loop for agentic systems that need explicit human approval.

Current governance surface:

- Human Cards: local operator authority resolved by alias, such as `operator:primary`.
- Redacted, agent-reachable authority resolution.
- Agent identity registry.
- Agent trust states and probation.
- Muted and blocked agent behavior.
- Structured, evidence-bearing approval requests.
- Risk tiers.
- Required authority scopes.
- Affected resource declarations.
- Expiration behavior.
- Denial behavior.
- Approval templates.
- Approval dry-run simulation.
- Risk-tiered interruption policy.
- Timeout and escalation recording.
- Agent etiquette fields.
- Operator-only decision records.
- Request, evidence, decision, and outcome hashes.
- Local tamper-evident audit chain.
- Approval outcome callbacks.
- Approval replay.
- Redaction profiles for different surfaces.
- Governance export.
- Communication firewall.
- Draft-don't-send behavior for external channels.
- External-contact consent ledger.
- Agent-facing governance contract.
- ForgeWire/Fabric HITL routing through ForgeLink.

The current guarantee is intentionally scoped:

ForgeLink provides **operator-only, replayable decision records with local tamper-evident audit linkage**. Device-key registry groundwork exists for future signed decision records, but the current audit model should be understood as local tamper-evidence, not cryptographic non-repudiation.

<p align="center">
  <img src="assets/readme/governance-loop.svg" alt="ForgeLink governed approval loop" width="100%">
</p>

---

## What ForgeLink Is Not

ForgeLink is not a social feed.

It is not a public messaging platform, engagement surface, hosted notification service, or arbitrary public API.

ForgeLink is also not a ForgeWire work runner. It does not execute distributed work. It provides the human boundary for systems that do.

The local API is intended to remain private and loopback-bound unless a future threat model explicitly justifies something else.

---

## Architecture

```text
Claude Code / Codex / VS Code / ForgeWire Fabric / Local Agents
        |
        v
forgelink-human MCP bridge
        |
        v
ForgeLink local authenticated API
        |
        +-- Agent messages
        +-- Approval requests
        +-- Human actions
        +-- Operator decision records
        +-- Agent identity and trust
        +-- Contacts and channel credentials
        +-- Attention policy
        +-- Communication firewall
        +-- Consent ledger
        +-- Tamper-evident audit chain
        |
        v
ForgeLink desktop app
        |
        +-- Decisions / approvals
        +-- Agents
        +-- Contacts
        +-- SMS / MMS adapters
        +-- Voice and call history
        +-- Trusted signals
        +-- Settings
        +-- Backup / export / retention
        |
        v
Human operator
```

The MCP bridge does not read or write ForgeLink's SQLite database directly.

It talks through ForgeLink's local API so the desktop app remains the owner of the human boundary.

---

## Current Product Surface

ForgeLink currently includes:

- Electron desktop app with setup wizard and settings UI.
- Provider-neutral channel architecture.
- Shared adapter conformance kit.
- Twilio and Telnyx SMS/MMS adapters.
- Twilio Voice call UI, durable call history, and call status reconciliation.
- Rich contacts and contact points.
- Per-contact policy.
- Redaction-aware contact timeline across messages, calls, and agent requests.
- Provider-optional local-only first run.
- Local SQLite storage.
- Backup, restore, export, and retention tools.
- Conversation drafts.
- Pending and failed outbound state recovery.
- Local authenticated agent-channel API.
- Agents view for human requests, approvals, and outcomes.
- Agent identity registry.
- Agent trust states and probation.
- Evidence-bearing approval requests.
- Risk tiers.
- Authority scopes.
- Operator-only decision records.
- Request/evidence/decision/outcome hashes.
- Local tamper-evident audit chain.
- Approval replay.
- Governance export.
- Communication firewall.
- Draft-don't-send external channel behavior.
- External-contact consent ledger.
- Redaction profiles.
- Node/TypeScript MCP bridge.
- MCP templates for multiple agentic apps.
- ForgeWire/Fabric HITL compatibility.
- MCP token creation, rotation, revocation, and testing.
- Per-channel credentials and urgency limits.
- Notification redaction, quiet hours, and human attention policy.
- RepoPact work ledger and validation evidence.

<p align="center">
  <img src="assets/readme/surface-maturity-chart.svg" alt="ForgeLink product surface maturity chart" width="100%">
</p>

---

## Requirements

- Node.js 22 or newer.
- PowerShell for the included MCP install helper on Windows.
- Optional: Twilio or Telnyx account and phone number for SMS/MMS features.
- Optional: Twilio account for voice features.

ForgeLink can run local-only without a telecom provider.

Packaged builds include the backend with the Electron app. Packaged builds do not require Python, Node, or native database modules at runtime.

---

## Quick Start

From the Electron app directory:

```powershell
cd Electron
npm install
npm start
```

On first launch, ForgeLink offers two paths:

1. **Start local-only**  
   Use ForgeLink for local agent approvals and the human decision loop without configuring a telecom provider.

2. **Configure a channel provider**  
   Set up an SMS/MMS edge such as Twilio or Telnyx.

Provider setup may include:

- account SID or API credentials
- auth token
- sending phone number
- public webhook URL
- local service address

Use **Test connection** before saving.

Stored provider auth tokens are encrypted with Electron `safeStorage` and are never returned to the renderer.

---

## Development

From the Electron app directory:

```powershell
cd Electron
npm test
npm run dev
```

The supported runtime is Electron plus:

```text
Electron/backend-dist/
```

The backend distribution is built from:

```text
Electron/backend/src/
```

The renderer source lives in:

```text
Electron/renderer/src/
```

The renderer build emits the packaged browser bundle at:

```text
Electron/renderer/app.js
```

Build the renderer:

```powershell
cd Electron
npm run renderer:build
```

---

## Twilio Setup

For incoming SMS/MMS, expose ForgeLink's local webhook port through a secure tunnel and configure the Twilio messaging webhook as:

```text
https://your-public-tunnel.example/webhooks/sms
```

Set the Twilio delivery status callback to:

```text
https://your-public-tunnel.example/webhooks/status
```

Environment variables remain supported for development and migration:

```powershell
$env:TWILIO_ACCOUNT_SID = "AC..."
$env:TWILIO_AUTH_TOKEN = "..."
$env:TWILIO_PHONE_NUMBER = "+15551234567"
$env:TWILIO_PUBLIC_BASE_URL = "https://your-public-tunnel.example"
```

If complete Twilio environment variables are present, ForgeLink can run from them and offers an explicit secure import.

It does not silently persist them.

---

## Local Data

ForgeLink stores app data in:

```text
%USERPROFILE%\.forgelink
```

Override the location with:

```powershell
$env:FORGELINK_DATA_DIR = "C:\path\to\forgelink-data"
```

On first launch, ForgeLink can conservatively import legacy data from:

```text
%USERPROFILE%\.twilio-phone
~/.config/TwilioPhone
```

Legacy import only runs when the new ForgeLink data targets do not already exist.

Outbound messages are written locally before a provider is called. Pending and failed states survive restarts, failed messages can be retried explicitly, delivery callbacks update the same local row, and conversation drafts are stored in SQLite.

The **Settings > Data safety** panel can:

- create verified SQLite and upload backups
- restore the latest managed backup
- write JSON exports
- apply message retention after making a safety backup

Backups and exports are sensitive plaintext and should be protected like the original message database.

---

## Agentic Apps And MCP

ForgeLink includes a Node/TypeScript MCP bridge for external agentic apps that need to reach a human without becoming a feed.

Build the MCP bridge:

```powershell
cd mcp/forgelink-human
npm install
npm run build
```

MCP templates live under:

```text
install/mcp-configs/
```

Templates are included for:

- Claude Code
- Codex
- VS Code / Copilot
- ForgeWire / Fabric
- other MCP-capable tools

The PowerShell installer can build the bridge and write app configs:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/install/install-forgelink-mcp.ps1 -Target all
```

The MCP bridge requires one of:

```text
FORGELINK_API_TOKEN
FORGELINK_API_TOKEN_FILE
FORGELINK_CHANNEL_TOKEN_FILE
```

The recommended path is file-backed credentials created, rotated, and revoked by ForgeLink from the desktop settings UI.

---

## Human Approval Flow

Agentic tools can create structured human requests through ForgeLink.

Example local API request:

```http
POST /api/agent-channels/:channel_id/messages
Authorization: Bearer <channel-token>
Content-Type: application/json
```

```json
{
  "source": "forgewire",
  "kind": "approval_request",
  "urgency": "normal",
  "title": "Task needs approval",
  "body": "ForgeWire wants to run a release workflow.",
  "actions": [
    { "id": "approve", "label": "Approve" },
    { "id": "deny", "label": "Deny" }
  ],
  "expires_at": "2026-06-15T22:00:00Z"
}
```

ForgeLink stores the request locally, shows it in the operator surface, records the human decision, and lets the originating side observe the outcome through the governed loop.

Related local API endpoints include:

```http
GET  /api/agent-messages
POST /api/agent-messages/:id/read
POST /api/agent-messages/:id/dismiss
POST /api/agent-messages/:id/actions/:action_id
```

Governed approval requests carry more structure than ordinary messages, including:

- intent
- requested action
- interruption reason
- risk tier
- required authority
- affected resources
- evidence
- expiration behavior
- denial behavior
- decision options

---

## ForgeWire/Fabric Compatibility

ForgeLink is designed to work as the human bridge inside ForgeWire/Fabric-style agent systems where tools, prompts, and resources are advertised as capabilities.

The ForgeLink MCP bridge advertises capabilities such as:

- `request_human_approval`
- `record_human_action`
- `forgelink://persona`
- `forgelink_request_approval`

The high-fidelity Fabric smoke emits:

- a Fabric-style `mcp_manifest`
- capability rows for tools, resources, and prompts
- a redacted approval/action transcript
- outcome observation from the originating MCP/Fabric side

Run the smoke:

```powershell
cd mcp/forgelink-human
npm run smoke:fabric
```

ForgeWire/Fabric HITL routing through ForgeLink is implemented.

When ForgeLink is reachable, Fabric can route held approvals to ForgeLink's governed decision surface, read the operator's decision back, and resolve the held approval. Operators can opt out, and Fabric can fall back to its built-in pane when ForgeLink is unavailable.

ForgeLink remains the human bridge.

It is not a ForgeWire work runner.

---

## Security Model

ForgeLink assumes human communication is sensitive local data.

Key security properties:

- Private loopback API routes require random credentials.
- Public webhook ingress is limited to provider webhook routes and documented media routes.
- Private routes remain credential-gated.
- Twilio webhooks use signature validation.
- Twilio auth tokens are encrypted with Electron `safeStorage`.
- Stored tokens are not returned to the renderer.
- MCP token files are local secrets.
- Renderer status is redacted.
- Raw token values are not exposed through status surfaces.
- Agent-channel credentials are stored as SHA-256 hashes.
- Channel credentials can be created, rotated, revoked, enabled, and disabled.
- JSON export includes channel metadata and counters, not raw credentials.
- MCP and channel test paths create local test messages without touching SMS, contacts, exports, uploads, or Twilio credentials.
- Agent-supplied content is treated as untrusted and sanitized.
- Decision and audit records are committed to a local tamper-evident audit chain.

Per-channel urgency limits currently use a fixed 60-second window:

```text
low    = 60
normal = 30
high   = 10
urgent = 3
```

This prevents a local integration from turning ForgeLink into a spam pipe.

<p align="center">
  <img src="assets/readme/security-boundary-posture.svg" alt="ForgeLink security and boundary posture" width="100%">
</p>

---

## Ingress Boundary

ForgeLink is local-first. Public exposure should be narrow and intentional.

The intended public ingress surface is limited to:

```text
/webhooks/*
/media/*
```

Provider webhook routes are signature-validated before reaching handlers. Private API routes, health routes, and control routes are not intended to be exposed publicly.

Local-only mode starts no tunnel and has no public webhook surface.

---

## Human Attention Policy

ForgeLink has one explicit policy layer for desktop interruptions.

The policy covers:

- SMS
- agent-channel messages
- trusted signals
- system notices
- quiet hours
- urgency
- redaction
- muted source IDs
- muted channel IDs

The goal is simple:

ForgeLink should help systems reach a person without turning human attention into an attention market.

---

## RepoPact Work Ledger

ForgeLink uses RepoPact work items for durable agent work.

The older `todos/` tree remains historical planning context. New cross-cutting product work should start in the RepoPact-compatible work ledger unless a narrower existing item already owns it.

Each work item contains:

- `README.md` for intent, decisions, scope, acceptance, and closeout narrative
- `work-item.json` for lifecycle state used by validators and dashboards
- optional local artifacts that are too specific to belong in central evidence

Work item IDs are permanent and never reused.

RepoPact gives ForgeLink a durable record of what work was requested, what evidence closed it, and which constraints the work had to respect.

---

## Project Status

ForgeLink is under active development.

Completed major work:

- **Work item 015 — Communication Channels and Voice**  
  Provider-neutral local-first channel architecture, SMS/MMS and voice edges, contacts and contact policy, call history, and contact timeline.

- **Work item 016 — Agent-Human Governance**  
  Agent identity and trust, Human Cards, evidence-bearing approval requests, risk tiers, authority scopes, operator decision records, audit chain, replay, export, communication firewall, consent ledger, redaction profiles, agent-facing governance contract, and ForgeWire/Fabric HITL routing.

Active / near-term work:

- **Work item 017 — Operator Cockpit and Native Experience**  
  A decision-first product surface for Decisions, People, Agents, and Channels; triage lanes; operator modes and presence; better approval review; batch flows; fatigue and reputation budgeting; and a mobile decision companion path.

Other near-term areas:

- sample workspace and synthetic demo mode
- public screenshots and demo flow
- additional channel adapters
- packaged installer decisions for the MCP bridge
- live registration flows for running ForgeWire/Fabric hubs
- continued attention-policy refinement

---

## Relationship To ForgeWire Labs

ForgeLink is part of the ForgeWire Labs public ecosystem.

- **ForgeWire/Fabric** provides the distributed task and control substrate.
- **RepoPact** provides repo-native governance and durable work primitives.
- **ForgeLink** provides the local-first human-agent communications and decision runtime.
- **SkillForge** provides an applied learning and certification product surface.

The ecosystem boundary is:

```text
ForgeWire/Fabric runs governed work.
RepoPact records whether the work respected the contract.
ForgeLink owns the human decision boundary.
```

ForgeLink exists because agentic systems need a better way to reach people than chat spam, hidden prompts, unmanaged notifications, and unverifiable approval prompts.

It is the local boundary where a system asks, a human decides, and the outcome is recorded without surrendering the human's attention to the machine.
