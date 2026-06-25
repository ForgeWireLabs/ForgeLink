---
audience: operators and integrating agents
status: current
last_verified: 2026-06-24
---

# Communication firewall and draft-don't-send

ForgeLink does not let agents talk to the outside world on their own. Every
external message an agent wants to send (SMS/MMS today) passes through an
operator-controlled **communication firewall** before any dispatch, and the
default posture is **draft-don't-send**: the agent can compose, but the operator
reviews and sends. This is work item 016, AGH-019 (firewall) and AGH-020
(draft-don't-send).

## Firewall rules (AGH-019)

A rule scopes who/what it applies to and the decision it enforces:

| Field | Meaning |
| --- | --- |
| `agent_id` | The agent identity it applies to; empty matches any agent. |
| `contact_id` | The local contact it applies to; null matches any contact. |
| `channel_kind` | `sms`, `mms`, `voice`, or `email`; empty matches any kind. |
| `rule_kind` | The decision: `block`, `draft_only`, `require_approval`, or `allow`. |
| `enabled` | Disabled rules are ignored during evaluation. |

Decisions:

- **block** — refuse the external message outright (for example "agents may never
  send MMS" or "agents may not call phone numbers").
- **draft_only** — the agent may only draft; the operator must send. This is also
  the default when no rule matches.
- **require_approval** — park the message as a draft that needs explicit operator
  approval before it can be sent.
- **allow** — explicit direct-send authority; the message is sent immediately and
  the authorization is audited.

### Evaluation order

`evaluateCommunicationFirewall` selects the **most specific** enabled matching
rule (a match on agent, contact, and channel kind each adds specificity). Ties
break toward the **more restrictive** decision (`block` > `require_approval` >
`draft_only` > `allow`), then the most recently updated rule. If nothing matches,
the decision is the draft-don't-send default. This lets an operator keep a strict
global default while allowing a specific trusted agent on a specific channel.

```http
GET    /api/communication-firewall                 # list rules (operator-only)
POST   /api/communication-firewall                 # create/update a rule
GET    /api/communication-firewall/evaluate?agent=&channel_kind=&contact_id=   # dry-run
DELETE /api/communication-firewall/<id>            # delete a rule
```

All firewall management is launch-only; agents cannot read or change policy.

## Draft-don't-send reviewed outbox (AGH-020)

An agent submits an external message over its channel credential:

```http
POST /api/agent-channels/<channel_id>/outbound-drafts
X-ForgeLink-Channel-Token: <channel credential>
{ "source": "<agent id>", "to": "+1555...", "body": "...", "channel_kind": "sms" }
```

The firewall is consulted before anything is sent:

- a **block** decision returns `403` with `reason: "firewall_blocked"` and no draft
  is created;
- an **allow** decision sends immediately (explicit, audited) and returns the sent
  draft;
- every other decision parks a pending draft and returns it for operator review.

Blocked or muted agents cannot submit at all. Only `sms`/`mms` drafts are
supported today; a rule can still `block` non-messageable kinds.

The operator works the reviewed outbox (launch-only):

```http
GET  /api/outbound-drafts[?status=draft]      # list drafts
GET  /api/outbound-drafts/<id>/events         # lifecycle audit trail
POST /api/outbound-drafts/<id>/edit           # edit body/media while pending
POST /api/outbound-drafts/<id>/deny           # refuse (terminal)
POST /api/outbound-drafts/<id>/approve-send   # explicit approval, then dispatch
```

`approve-send` re-evaluates the firewall (a rule added after drafting still binds),
records the operator's explicit approval, then dispatches through the channel
registry and lands the message in the conversation thread. Every transition —
`draft_created`, `draft_edited`, `draft_approved`, `draft_sent`, `draft_denied`,
`draft_failed` — is recorded in the draft's event log, so direct-send authority is
always auditable.

## Boundaries

- The firewall governs agent-originated external messages; it does not change the
  operator's own `/api/send`.
- Drafts and firewall rules participate in the durable local export.
- This is the firewall and safe-drafting layer; external-contact consent
  (AGH-021) and per-surface redaction profiles (AGH-022) build on it.
