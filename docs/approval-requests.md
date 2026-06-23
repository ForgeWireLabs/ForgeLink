# Structured Approval Requests (work item 016, AGH-006)

ForgeLink accepts agent approval requests through the existing local agent-channel
route, but `kind: "approval_request"` now has a structured contract. The schema
makes the operator-facing approval card reproducible: the request states what the
agent intends, what action it wants to take, why it is interrupting, what
authority is required, what resources are affected, how expiration behaves, what
denial means, and which decisions the human may choose.

```http
POST /api/agent-channels/<channel>/messages
```

```jsonc
{
  "source": "codex",
  "kind": "approval_request",
  "urgency": "normal",
  "title": "Release approval",
  "body": "Codex wants to publish the release.",
  "intent": "Publish ForgeLink 2.0.3",
  "requested_action": "Create the release commit and publish the signed installer.",
  "reason_for_interrupt": "The agent cannot publish without operator release authority.",
  "risk": "normal",
  "required_authority": "release_approval",
  "to_human": "operator:primary",
  "affected_resources": ["repo:ForgeLink", "release:2.0.3"],
  "expires_at": "2026-06-23T23:00:00.000Z",
  "timeout_behavior": "deny_on_timeout",
  "deny_behavior": "do_not_publish",
  "decision_options": [
    { "id": "approve", "label": "Approve" },
    { "id": "deny", "label": "Deny" }
  ]
}
```

## Required Fields

For `kind: "approval_request"`, ForgeLink requires:

| Field | Purpose |
| --- | --- |
| `intent` | Plain-language goal the agent is trying to accomplish. |
| `requested_action` | Specific operation the agent wants to perform after approval. |
| `reason_for_interrupt` | Why the human needs to be interrupted now. |
| `risk` | Agent-declared risk label. Risk-tier enforcement is AGH-010. |
| `required_authority` | Authority scope checked against Human Cards, such as `release_approval`. |
| `to_human` | Human Card alias addressed by the request. Defaults to `operator:primary` only when omitted before validation. |
| `affected_resources` | Bounded list of local identifiers for repos, files, workflows, contacts, or systems. |
| `expires_at` | ISO timestamp after which the request is expired. |
| `timeout_behavior` | What the agent must do if the request expires or receives no answer. |
| `deny_behavior` | What the agent must do if the operator denies the request. |
| `decision_options` | Up to eight operator choices. Existing `actions` are still accepted for UI compatibility, but `decision_options` is the governed schema field. |

Requests missing these structured fields are rejected with `400`. Requests whose
addressed human lacks `required_authority` are rejected with `403` and escalation
targets, preserving AGH-002 authority behavior.

## Persistence

The structured fields are stored on `agent_messages` in schema version **v14**.
The original `title`, `body`, and `actions` fields remain for existing list and
action UI, while the structured fields are available to approval-card, evidence,
decision-record, and replay work in later AGH criteria.

## Boundaries

- Evidence packs are AGH-007; AGH-006 records only request structure.
- Risk-tier classification and interruption policy are AGH-010.
- Timeout and escalation execution are AGH-011; AGH-006 records the declared
  behavior.
- Decision records, callbacks, audit chain, and replay are AGH-013 through
  AGH-017.
