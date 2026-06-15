# 003 — Agentic Human Communications Channel

> **Status**: Completed 2026-06-15.
> **Owners**: backend-agent lead, Security Agent, UI Agent, Data Agent, Docs Agent supporting.
> **Depends on**: Work item `001`.

## Intent

Make ForgeLink the human-facing communications surface for ForgeWire and other
agentic applications. Agents and local systems should be able to reach a human
through ForgeLink without becoming another feed, social stream, or attention
contest.

This is in scope:

- A local authenticated API for agent-originated human messages.
- Source identity, intent, urgency, expiry, and actionable responses.
- Persistence, auditability, retention, backup/export, and recovery behavior.
- UI that treats agent messages as chosen communications, not content.
- Documentation and integration evidence from ForgeWire or another local
  agentic app.

This is out of scope:

- Public social posting, follower mechanics, engagement ranking, or algorithmic
  feed behavior.
- Unauthenticated local callers.
- Letting agents send personal data to external providers without explicit
  channel rules.

## Product Model

ForgeLink should become the private boundary between people and systems:

```text
ForgeWire / Local Agents / Other Agentic Apps
        |
        v
ForgeLink local channel API
        |
        +-- Inbox
        +-- Contacts
        +-- SMS / voice adapters
        +-- Signals / RSS adapters
        +-- Agent channels
        +-- Routing and retention
        |
        v
Human
```

Agent messages are communications, not content. Every automated message should
carry enough metadata for a person to understand who is asking, why now, what
action is requested, when it expires, and what happens if the action fails.

## Implemented Contract

```http
POST /api/agent-channels/:channel_id/messages
Authorization: Bearer <local launch token>
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

Additional implemented endpoints:

```http
GET /api/agent-messages
POST /api/agent-messages/:id/read
POST /api/agent-messages/:id/dismiss
POST /api/agent-messages/:id/actions/:action_id
```

## Closeout

Completed with:

- Authenticated local agent-channel API in `Electron/backend/src/server.ts`.
- SQLite schema version 4 with `agent_messages` separate from SMS/MMS messages
  in `Electron/backend/src/database.ts`.
- Backup/export/retention coverage for agent messages.
- Renderer **Agents** view with active requests and recent outcomes.
- Contract and security documentation in `docs/agent-channels.md`.
- Prototype evidence in
  `evidence/runs/20260615-agentic-human-comms-channel.json`.

## Remaining Hardening

- Add per-channel credentials, revocation, and operator-visible channel
  configuration before accepting untrusted third-party callers.
- Add dedicated rate limits for local agent callers.
- Decide whether future urgent messages can bridge to notifications or SMS
  without creating spam.

## Verification

- `cd Electron && npm test`
- `cd Electron && npm run screenshot`
- Local ForgeWire-style prototype posted an approval request, listed it,
  recorded an `approve` action, and verified `sms_thread_count` remained `0`.
