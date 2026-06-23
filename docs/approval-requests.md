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

## Boundaries

- Risk-tier classification and interruption policy are AGH-010.
- Timeout and escalation execution are AGH-011; AGH-006 records the declared
  behavior.
- Decision records, callbacks, audit chain, and replay are AGH-013 through
  AGH-017.
