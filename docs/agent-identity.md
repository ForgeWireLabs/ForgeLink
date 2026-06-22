# Agent Identity Registry (work item 016, AGH-003)

ForgeLink ties every agent-originated request to a first-class **agent identity**
so the operator can see who is asking, who owns them, and how far they are
trusted. Identities are local governance records, separate from the
`agent_channels` credentials that carry the transport.

## What an identity holds

| Field | Meaning |
| --- | --- |
| `id` | Stable agent id (matches the request `source`, e.g. `codex`). |
| `display_name` | Human-readable name. |
| `source_kind` | `mcp`, `repo`, `app`, `local_workflow`, … |
| `source_uri` | Where the agent comes from (repo/app URL). |
| `owner` | Who is responsible for the agent. |
| `signing_key_ref` | Reference to a stable local identity/key (real key management is AGH-025). |
| `trust_state` | `unknown`, `probation`, `trusted`, `restricted`, `muted`, `blocked`. |
| `default_risk_limit` | Default ceiling for what the agent may request (enforced by AGH-010). |
| `allowed_channels` / `allowed_tools` | Allow-lists for the agent. |
| `escalation_alias` | Human Card alias to escalate to. |
| `last_seen_at` | Last time the agent contacted ForgeLink. |

## Auto-registration with restricted defaults

When an agent posts a message, ForgeLink ties the request to its identity. An
agent seen for the first time is **auto-registered with restricted defaults**:
`trust_state = "unknown"`, empty `allowed_channels` and `allowed_tools`. The
acceptance response echoes the identity:

```jsonc
POST /api/agent-channels/<channel>/messages   ->   201
{ "ok": true, "message": { ... }, "agent": { "id": "codex", "trust_state": "unknown" } }
```

Re-contact updates `last_seen_at` without creating duplicates. Trust-state
*transitions* (probation, promotion, blocking) and their audit are AGH-004; the
restriction of what an `unknown` agent may actually do is enforced by the trust
(AGH-004) and risk-tier (AGH-010) layers. AGH-003 establishes the identity and
its restricted starting point.

## Operator management

The registry is **operator-only** (local launch token); agents cannot list or
edit it.

```http
GET  /api/agent-identities          # list (launch only)
POST /api/agent-identities          # create/update by id (launch only)
```

```jsonc
POST /api/agent-identities
{ "id": "codex", "display_name": "Codex", "owner": "platform",
  "trust_state": "trusted", "allowed_tools": ["git_commit"],
  "escalation_alias": "operator:primary" }
```

Management updates governance fields but never resets `last_seen_at`. An invalid
`trust_state` is rejected.

## Trust states and probation (AGH-004)

An identity's `trust_state` is one of:

```text
unknown · probation · trusted · restricted · muted · blocked
```

### Enforcement at ingestion

- **Muted or blocked agents cannot interrupt.** A message from a `muted` or
  `blocked` agent is rejected with `403` (`reason: agent_muted` / `agent_blocked`).
- **New agents stay conservative.** Only a `trusted` agent may raise an **urgent**
  interrupt; `unknown`/`probation`/`restricted` agents requesting `urgency:
  "urgent"` are rejected with `403` (`reason: insufficient_trust_for_urgent`) and
  can resend at a lower urgency. Normal/low/high traffic from non-blocked agents is
  unaffected.

### Audited transitions

Trust changes are **explicit operator decisions** and every change is recorded in
a tamper-visible audit log (`agent_trust_events`: `from_state`, `to_state`,
`reason`, `changed_at`). Both the dedicated trust endpoint and ordinary management
updates write an event when the state actually changes.

```http
POST /api/agent-identities/<id>/trust          # { "trust_state": "...", "reason": "..." }  (launch only)
GET  /api/agent-identities/<id>/trust-events    # audit log, newest first (launch only)
```

A no-op transition (same state) writes no event; an invalid state or unknown
agent is rejected.

## Notes

- Schema ownership: `agent_identities` is schema version **v12**, owned by work
  item 016 per [decision 0011](../decisions/0011-schema-migration-coordination.md).
- A well-formed request grants no trust; identities start `unknown`.
- The agent `id` equals the request `source`; durable per-message linkage of the
  identity arrives with the approval request schema (AGH-006).
