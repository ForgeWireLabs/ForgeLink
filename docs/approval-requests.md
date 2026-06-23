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
  "expected_response_time": "15 minutes",
  "no_response_behavior": "deny_on_timeout",
  "can_batch": false,
  "can_wait_until": null,
  "template_id": "github_release",
  "decision_options": [
    { "id": "approve", "label": "Approve" },
    { "id": "deny", "label": "Deny" }
  ],
  "evidence_pack": {
    "summary": "Release candidate is ready for operator review.",
    "affected_resources": ["repo:ForgeLink", "release:2.0.3"],
    "diff_summary": "Release metadata and installer artifacts only.",
    "proposed_operation": "Publish the release and attach the installer.",
    "checks": ["backend tests passed", "renderer build passed"],
    "rollback_plan": "Delete the draft release and restore the prior tag.",
    "links": ["local://evidence/release-check"],
    "limitations": "Installer signing is operator-provided.",
    "redaction_profile": "desktop_full"
  }
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
| `expected_response_time` | Human-readable time window the agent expects, such as `15 minutes`. |
| `no_response_behavior` | What the agent will do if no response arrives. |
| `can_batch` | Whether the request can be batched instead of interrupting immediately. |
| `can_wait_until` | ISO timestamp for the latest acceptable wait time when `can_batch` is true. |
| `template_id` | Approval template/playbook id. Defaults are visible through `/api/approval-templates`. |
| `decision_options` | Up to eight operator choices. Existing `actions` are still accepted for UI compatibility, but `decision_options` is the governed schema field. |
| `evidence_pack` | Evidence summary the human can review without reading raw agent logs. |

Requests missing these structured fields are rejected with `400`. Requests whose
addressed human lacks `required_authority` are rejected with `403` and escalation
targets, preserving AGH-002 authority behavior.

## Persistence

The structured fields are stored on `agent_messages` in schema version **v14**.
Evidence packs and template ids are stored on `agent_messages` in schema version
**v15**.
The original `title`, `body`, and `actions` fields remain for existing list and
action UI, while the structured fields are available to approval-card, evidence,
decision-record, and replay work in later AGH criteria.

## Evidence Packs

`evidence_pack` is required for `approval_request` submissions. It contains the
operator-reviewable evidence for the requested action:

| Field | Purpose |
| --- | --- |
| `summary` | Short human-readable evidence summary. |
| `affected_resources` | Bounded resource list; repeated here so the evidence can stand alone. |
| `diff_summary` | What changed or would change, without forcing the human into raw logs. |
| `proposed_operation` | Operation the agent proposes to run. |
| `checks` | Tests, inspections, dry-runs, or validations already performed. |
| `rollback_plan` | How to undo or stop the action when rollback is possible. |
| `links` | Local or redacted evidence references. |
| `limitations` | Known gaps, assumptions, or residual risks. |
| `redaction_profile` | Channel/profile hint such as `desktop_full`, `mobile_redacted`, or `sms_minimal`. |

ForgeLink stores the pack as bounded JSON and returns it with the agent message.
The UI can render an approval card from these fields without trusting or exposing
raw agent logs. Low-trust channel redaction is still a later surface-specific
policy; AGH-007 records the profile and the redacted evidence shape.

## Templates

Agents can inspect reusable playbooks through:

```http
GET /api/approval-templates
```

The initial catalog covers:

```text
file_write
data_delete
git_commit
github_release
mirror_sync
external_message
credential_change
network_access
purchase
provider_setting_change
```

Each template declares required request fields, minimum evidence, default risk,
timeout behavior, allowed decision options, rollback requirement, and audit
requirement. Templates guide validation and dry-run responses; they do not grant
authority by themselves.

## Dry-Run

Agents can simulate a request before interrupting the operator:

```http
POST /api/approval-requests/dry-run
```

The response includes:

```jsonc
{
  "approval_required": true,
  "estimated_risk": "high",
  "missing_evidence": ["rollback_plan"],
  "preferred_channel": "desktop",
  "batching_defer_recommendation": "send_now",
  "validation_errors": ["rollback_plan is required"],
  "template": { "id": "github_release", "...": "..." },
  "authority": { "granted": true, "...": "..." }
}
```

Dry-run performs validation and authority simulation only. It does not persist a
message, notify the human, consume rate limits, or imply approval.

## Risk, Timeout, and Etiquette

ForgeLink classifies approval requests into an `interruption_policy` before they
reach the operator:

| Policy | Use |
| --- | --- |
| `log_only` | No operator interruption; keep an audit trail only. |
| `passive_notification` | Non-urgent, low-risk information. |
| `normal_approval` | Ordinary approval card, optionally batched in focus mode. |
| `urgent_interrupt` | High-risk, urgent, or emergency-only routing. |
| `fail_closed_critical_approval` | Critical/emergency risk; do nothing unless approval can be obtained. |
| `multi_party_cannot_proceed` | Authority/contact/operator state prevents progress. |

Routing considers declared risk, urgency, addressed authority, contact policy,
operator mode, and agent trust. The current operator mode is supplied as
`operator_mode` on dry-run or submit payloads and defaults to `available`.

Approval requests also carry explicit timeout/escalation behavior:

- `timeout_behavior` and `no_response_behavior` declare the agent's fail-safe.
- `escalation_behavior` is computed by ForgeLink and persisted with the message.
- When a request expires, ForgeLink marks it `expired` and records an
  `agent_message_events` audit event. Events are visible at:

```http
GET /api/agent-messages/<id>/events
```

The etiquette fields (`urgency`, `reason_for_interrupt`,
`expected_response_time`, `no_response_behavior`, `can_batch`, and
`can_wait_until` when batching is allowed) are required for
`approval_request`. Badly formed or under-explained requests are rejected before
they can interrupt the operator.

## Boundaries

- Decision records, callbacks, audit chain, and replay are AGH-013 through
  AGH-017.
