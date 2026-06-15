# 003 — Agentic Human Communications Channel

> **Status**: Active.
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

## Initial Contract Sketch

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

## Open Questions

- Should channels be configured in ForgeLink settings, a local token file, or an
  OS-encrypted store?
- Should actions call back to the originating agent, or should ForgeLink expose
  a polling API for action results?
- How should urgent agent messages bridge to SMS or desktop notifications
  without creating spam?
- What is the first ForgeWire integration: task approval, release approval,
  operator prompt, or alerting?

## Closeout

This work closes only when the API, persistence, UI, docs, security notes, and
one integration evidence record are all present.
