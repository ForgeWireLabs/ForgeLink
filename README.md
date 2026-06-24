# ForgeLink

**ForgeLink is a local-first communications and decision runtime for humans and agents.**

It is the private boundary where agents request human attention, authority, and
decisions — and where a human operator reviews, approves, denies, defers, and
replays that activity — without becoming another feed, leaking secrets into
ordinary chat surfaces, or turning the operator into a notification target.

ForgeLink is built for both sides of the relationship. Agents need a governed way
to communicate, request authority, and report outcomes; humans need a private,
inspectable place to decide. Channels — SMS/MMS, voice, and future adapters — are
edges. The center is governed communication state.

Today ForgeLink ships a provider-neutral communications runtime (Twilio and Telnyx
SMS/MMS, Twilio Voice, durable call history, and a contact timeline), rich contacts
with per-contact attention policy, and a working agent-human governance layer —
agent identity and trust, evidence-bearing approval requests, risk tiers, signed and
replayable decision records, and a tamper-evident audit chain — on top of an Electron
desktop app with local SQLite storage, an MCP human bridge, per-channel credentials,
backup/export tooling, and an explicit attention policy.

> Agent messages are communications, not content.

## Why ForgeLink Exists

Agentic systems eventually need to reach a person.

Most systems solve that with a chat window, a popup, a webhook, a Slack bot, or
an approval prompt bolted onto a workflow. That works for demos, but it does not
give the human a durable boundary. It does not answer the important questions:

- Who is asking for attention?
- Why now?
- What action is requested?
- How urgent is it?
- When does the request expire?
- What happens if the human says no?
- Which systems are allowed to interrupt?
- What data leaves the local machine?

ForgeLink treats those questions as product infrastructure.

It is a local-first communications console where trusted systems can request
human attention through explicit channels, credentials, policies, retention
rules, and auditable outcomes.

## What ForgeLink Is

ForgeLink is currently four things working together:

1. **A local-first communications runtime**
   - Electron desktop client with a React/TypeScript renderer and a bundled
     TypeScript backend.
   - Local SQLite persistence using Node's built-in SQLite support.
   - Provider-neutral channel architecture: native, internet, and telecom-edge
     adapters behind one capability contract, with a shared conformance kit every
     adapter must pass.
   - SMS/MMS through Twilio and Telnyx; Twilio Voice with durable call history.
   - Rich contacts, contact points / channel identities, and per-contact
     attention policy.
   - A redaction-aware contact timeline across messages, calls, and agent requests.
   - Provider-optional first run: usable local-only with no telecom provider.
   - Backup, restore, export, retention, and delivery-state handling.

2. **A human bridge for agentic apps**
   - Local authenticated agent-channel API.
   - MCP bridge for Claude Code, Codex, VS Code/Copilot, ForgeWire/Fabric, and
     other MCP-capable tools.
   - Tools for human messages, approval requests, message lookup, dismissal,
     action recording, and channel status.
   - Resources and prompts that describe the human communication contract.

3. **An attention policy layer**
   - Quiet hours.
   - Source and channel pause/mute controls.
   - Urgency-aware behavior.
   - Redacted desktop notifications by default.
   - Explicit rules for when agent messages, SMS, trusted signals, and system
     notices are allowed to interrupt.

4. **An agent-human governance layer**
   - Human Cards: resolvable local operator authority by alias (for example
     `operator:primary`), with redacted, agent-reachable resolution.
   - An agent identity registry with trust states and probation, so muted or
     blocked agents cannot interrupt and only trusted agents can raise urgent ones.
   - Structured, evidence-bearing approval requests carrying intent, requested
     action, risk tier, required authority scope, and affected resources.
   - Signed, replayable decision records written only from the local operator
     surface, so an agent cannot forge an operator decision.
   - A tamper-evident audit chain and approval outcome callbacks.

This layer (work item 016) is in progress; the operator cockpit that turns it
into a decision-first product surface (work item 017) is planned. See
[Project Status](#project-status).

## What ForgeLink Is Not

ForgeLink is not a social feed.

It is not a public messaging platform, engagement surface, agent work runner, or
hosted notification relay. It does not rank content for attention, create
follower mechanics, or expose a public API for arbitrary callers.

The local API is intended to remain private and loopback-bound unless a future
threat model explicitly justifies something else.

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
        +-- Approval requests (evidence, risk, authority)
        +-- Human actions and decision records
        +-- Agent identity and trust
        +-- Contacts and channel credentials
        +-- Attention policy
        +-- Tamper-evident audit
        |
        v
ForgeLink desktop app
        |
        +-- Agents view / approvals
        +-- SMS / MMS adapters (Twilio, Telnyx)
        +-- Calls (Twilio Voice) and call history
        +-- Trusted signals
        +-- Contacts and contact policy
        +-- Settings
        +-- Backup / export / retention
        |
        v
Human
```

The MCP bridge does not read or write ForgeLink's SQLite database directly. It
talks through ForgeLink's local API so the desktop app remains the owner of the
human boundary.

## Requirements

- Node.js 22 or newer
- A Twilio or Telnyx account and phone number for SMS/MMS features (optional —
  ForgeLink runs local-only with no telecom provider)
- PowerShell for the included MCP install helper on Windows

ForgeLink packages its backend with the Electron app. Packaged builds do not
require Python, Node, or native database modules at runtime.

## Quick Start

From the Electron app directory:

```powershell
cd Electron
npm install
npm start
```

On first launch, ForgeLink offers a **Start local-only** path (agent approvals and
the local human loop, no telecom provider) or a setup wizard to configure an
SMS/MMS edge:

- Twilio (or Telnyx) account SID / API credentials
- auth token
- sending phone number
- public webhook URL
- local service address

Use **Test connection** before saving. Stored provider auth tokens are encrypted
with Electron `safeStorage` and are never returned to the renderer.

## Development

```powershell
cd Electron
npm test
npm run dev
```

The supported runtime is Electron plus `Electron/backend-dist/`, built from
`Electron/backend/src/`.

The renderer source lives in `Electron/renderer/src/`. The renderer build emits
the packaged browser bundle at `Electron/renderer/app.js`.

```powershell
cd Electron
npm run renderer:build
```

## Twilio Setup

For incoming SMS/MMS, expose ForgeLink's local webhook port through a secure
tunnel and configure the Twilio messaging webhook as:

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

If complete Twilio environment variables are present, ForgeLink can run from
them and offers an explicit secure import. It does not silently persist them.

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

- `%USERPROFILE%\.twilio-phone`
- `~/.config/TwilioPhone`

Legacy import only runs when the new ForgeLink data targets do not already
exist.

Outbound messages are written locally before Twilio is called. Pending and
failed states survive restarts, failed messages can be retried explicitly,
delivery callbacks update the same local row, and conversation drafts are stored
in SQLite.

The **Settings > Data safety** panel can:

- create verified SQLite and upload backups
- restore the latest managed backup
- write JSON exports
- apply message retention after making a safety backup

Backups and exports are sensitive plaintext and should be protected like the
original message database.

## Agentic Apps And MCP

ForgeLink includes a Node/TypeScript MCP bridge for external agentic apps that
need to reach a human without becoming a feed.

Build the MCP bridge:

```powershell
cd mcp/forgelink-human
npm install
npm run build
```

MCP templates for VS Code/Copilot, Claude Code, Codex, and ForgeWire/Fabric live
under:

```text
install/mcp-configs/
```

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

The recommended path is file-backed credentials created, rotated, and revoked by
ForgeLink from the desktop settings UI.

## Human Approval Flow

Agentic tools can create structured human requests through ForgeLink:

```http
POST /api/agent-channels/:channel_id/messages
Authorization: Bearer <channel token>
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
    {"id": "approve", "label": "Approve"},
    {"id": "deny", "label": "Deny"}
  ],
  "expires_at": "2026-06-15T22:00:00Z"
}
```

ForgeLink stores the request locally, shows it in the Agents view, records the
human action, and lets the originating side observe the outcome.

Related local API endpoints include:

```http
GET /api/agent-messages
POST /api/agent-messages/:id/read
POST /api/agent-messages/:id/dismiss
POST /api/agent-messages/:id/actions/:action_id
```

## ForgeWire/Fabric Compatibility

ForgeLink is designed to work as a human bridge inside ForgeWire/Fabric-style
agent systems where tools, prompts, and resources are advertised as
capabilities.

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

The ForgeLink MCP bridge advertises capabilities such as:

- `request_human_approval`
- `record_human_action`
- `forgelink://persona`
- `forgelink_request_approval`

ForgeLink remains the human bridge. It is not a ForgeWire work runner.

## Security Model

ForgeLink assumes human communication is sensitive local data.

Key security properties:

- Private loopback API routes require random per-launch credentials.
- Twilio webhooks use signature validation.
- Twilio auth tokens are encrypted with Electron `safeStorage`.
- Stored tokens are not returned to the renderer.
- MCP token files are local secrets.
- Renderer status is redacted: present, missing, rotated, revoked, path, and
  last test result are acceptable; raw token values are not.
- Agent-channel credentials are stored as SHA-256 hashes.
- Channel credentials can be created, rotated, revoked, enabled, and disabled.
- JSON export includes channel metadata and counters, not raw credentials.
- MCP and channel test paths create local test messages without touching SMS,
  contacts, exports, uploads, or Twilio credentials.

Per-channel urgency limits currently use a fixed 60-second window:

```text
low    = 60
normal = 30
high   = 10
urgent = 3
```

This prevents a local integration from turning ForgeLink into a spam pipe.

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

Default behavior:

- RSS/trusted signals are quiet by default.
- Only high or urgent agent messages interrupt by default.
- Direct SMS notifications avoid body text by default.
- Agent notification bodies are redacted by default.
- Notification text is scrubbed for Twilio account SIDs, ForgeLink tokens,
  phone-number-like values, and URLs.

The goal is simple: ForgeLink should help systems reach a person without turning
human attention into an attention market.

## RepoPact Work Ledger

ForgeLink uses RepoPact work items for durable agent work.

The older `todos/` tree remains historical planning context. New cross-cutting
product work should start in the RepoPact-compatible work ledger unless a
narrower existing item already owns it.

Each work item contains:

- `README.md` for intent, decisions, scope, acceptance, and closeout narrative
- `work-item.json` for lifecycle state used by validators and dashboards
- optional local artifacts that are too specific to belong in central evidence

Work item IDs are permanent and never reused.

## Current Product Surface

ForgeLink currently includes:

- Electron desktop app with setup wizard and settings UI
- provider-neutral channel architecture and a shared adapter conformance kit
- Twilio and Telnyx SMS/MMS adapters (Plivo/Bandwidth recorded as planning gates)
- Twilio Voice: call UI, durable call history, and call status reconciliation
- rich contacts, contact points / channel identities, and per-contact policy
- a redaction-aware contact timeline across messages, calls, and agent requests
- provider-optional local-only first run (no telecom provider required)
- local SQLite storage; backup, restore, export, and retention tools
- conversation drafts and pending/failed outbound state recovery
- local authenticated agent-channel API
- Agents view for human requests, approvals, and outcomes
- agent identity registry with trust states and probation
- evidence-bearing approval requests with risk tiers and authority scopes
- signed, replayable decision records and a tamper-evident audit chain
- Node/TypeScript MCP bridge with templates for multiple agentic apps
- ForgeWire/Fabric smoke compatibility
- MCP token creation, rotation, revocation, and testing
- per-channel credentials and rate limits
- notification redaction, quiet hours, and human attention policy
- RepoPact work ledger and validation evidence

## Project Status

ForgeLink is under active development.

The communications runtime (work item 015) is complete: a provider-neutral,
local-first channel architecture with SMS/MMS and voice edges, contacts and
contact policy, call history, and a contact timeline. The agent-human governance
layer (work item 016) is in progress — agent identity and trust, evidence-bearing
approval requests, risk tiers, decision records, and a tamper-evident audit chain
have landed, with the remaining governance criteria still open. The operator
cockpit (work item 017) — a decision-first inbox with Decisions / People / Agents /
Channels surfaces, triage lanes, operator modes and presence, batch approvals, an
agent fatigue/reputation budget, and a mobile decision companion — is planned.

Near-term areas include:

- completing the remaining 016 governance criteria
- the 017 operator cockpit information architecture
- additional channel adapters (email, push, Telegram, WhatsApp, Discord, RSS)
- packaged installer decisions for the MCP bridge
- live registration flows for running ForgeWire/Fabric hubs
- continued attention-policy refinement

## Relationship To ForgeWire Labs

ForgeLink is part of the ForgeWire Labs public ecosystem.

- **ForgeWire/Fabric** provides the distributed task and control substrate.
- **RepoPact** provides repo-native governance and durable work primitives.
- **ForgeLink** provides the local-first human-agent communications and decision runtime.
- **SkillForge** provides an applied learning and certification product surface.

ForgeLink exists because agentic systems need a better way to reach people than
chat spam, hidden prompts, and unmanaged notifications.

It is the local boundary where a system asks, a human decides, and the outcome is
recorded without surrendering the human's attention to the machine.
