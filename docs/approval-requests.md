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

## Decision Records

When the operator acts on an approval request, ForgeLink persists a **Decision
Record** (work item 016, AGH-013) capturing what the human saw and decided so the
decision can be replayed and integrity-checked later.

A record is written when the operator approves an option or dismisses an approval
request from the local operator surface:

```http
POST /api/agent-messages/<id>/actions/<optionId>
POST /api/agent-messages/<id>/dismiss
```

Both accept an optional JSON body so the operator can attach context:

```jsonc
{
  "comment": "Approved after reviewing the rollback plan.",
  "device_id": "desktop-1",
  "operator_alias": "operator:primary"
}
```

The response includes the stored `decision` record. Each record holds:

| Field | Purpose |
| --- | --- |
| `id` | Stable decision record id. |
| `approval_request_id` | The agent message that was decided. |
| `operator_alias` | Human Card alias of the deciding operator (defaults to `operator:primary`). |
| `device_id` | Operator device identifier when supplied. |
| `decision` | The chosen option id, e.g. `approve` or `deny`. |
| `selected_options` | The options the operator selected. |
| `decision_comment` | Optional operator note. |
| `authority_grant` | The authority the operator exercised — the request's `required_authority` on a non-denial decision, empty on a denial. A decision never invents authority the request did not declare. |
| `request_hash` | SHA-256 over the governed request fields, binding the record to exactly what was decided. |
| `evidence_hash` | SHA-256 over the stored evidence pack. |
| `decision_hash` | SHA-256 over the record's own fields, making the record tamper-evident. |
| `decided_at` | ISO timestamp of the decision. |

Each decision also appends a `decision` event to the message's
`agent_message_events` audit trail. Records are operator-only:

```http
GET /api/decision-records                       # all decisions (newest first)
GET /api/agent-messages/<id>/decision           # latest decision for one request
```

Decision Records are only written from the local operator surface (launch token),
never from an agent (MCP) token, so a well-formed agent action cannot forge an
operator decision. The read endpoints reject agent tokens.

## Decision Memory

ForgeLink notices when the operator decides the same kind of request the same way
repeatedly and offers it as *suggested* policy (work item 016, AGH-014). A
suggestion fires when the same agent source, approval template, and required
authority were decided the same direction (approve or deny) at least three times.
Suggestions are operator-only and read-only:

```http
GET /api/decision-memory/suggestions
```

```jsonc
[
  {
    "source": "codex",
    "template_id": "github_release",
    "required_authority": "release_approval",
    "suggested_decision": "approve",
    "occurrences": 3,
    "last_decided_at": "2026-06-23T20:00:00.000Z",
    "requires_confirmation": true
  }
]
```

The operator explicitly confirms or dismisses a suggestion; either records an
advisory rule and removes the pattern from future suggestions:

```http
POST /api/decision-memory/confirm     # body: source, template_id, required_authority, suggested_decision, note?
POST /api/decision-memory/dismiss     # same body
GET  /api/decision-memory             # confirmed/dismissed rules
```

Decision memory **never expands agent authority and never auto-decides**. A
confirmed rule is operator-facing metadata only — it is not read by the approval
path, so a future matching request still requires an explicit operator decision.
Confirmation is always an explicit operator action; ForgeLink does not create or
apply rules on its own. These endpoints are operator-only.

## Outcomes

After a decision, the agent reports what actually happened (work item 016,
AGH-015) so the operator can see whether approved actions completed and whether
they stayed within the approved scope. The agent reports over its own token:

```http
POST /api/agent-messages/<id>/outcome
```

```jsonc
{
  "outcome_state": "action_succeeded",
  "outcome_summary": "Published the release.",
  "reported_resources": ["repo:ForgeLink", "release:2.0.3"]
}
```

`outcome_state` is one of `action_started`, `action_succeeded`, `action_failed`,
`expired_before_use`, `used_modified_scope`, or `cancelled`. ForgeLink computes a
`scope_match`: it is `0` when the agent declares `used_modified_scope`, or when a
reported resource was not part of the approved `affected_resources`. Each outcome
is audited as an `outcome` message event and committed to the audit chain.

Operators review outcomes through operator-only endpoints:

```http
GET /api/agent-messages/<id>/outcomes      # outcomes for one request
GET /api/approvals/dangling                # approved, no terminal outcome yet
GET /api/approvals/scope-mismatches        # outcomes flagged scope_match = 0
```

An approval is **dangling** when it was granted authority but has not reported a
terminal outcome (`action_succeeded`, `action_failed`, `cancelled`, or
`expired_before_use`), so stalled or unreported actions stay visible.

## Audit Chain

Governance records are committed to an append-only, hash-linked **audit chain**
(work item 016, AGH-016) so a later edit to any record — or to the chain itself —
is detectable after the fact. This is a lightweight local integrity check, not
blockchain or remote attestation.

When an approval request is created, ForgeLink appends an `approval_request` entry
(and an `evidence_pack` entry when a pack is present). When the operator decides,
it appends a `decision` entry, and when the agent reports an outcome it appends an
`outcome` entry. Each entry stores:

| Field | Purpose |
| --- | --- |
| `seq` | Monotonic position in the chain. |
| `entry_type` | `approval_request`, `evidence_pack`, or `decision`. |
| `ref_id` | The referenced record's id. |
| `approval_request_id` | The owning approval request, for per-request replay. |
| `payload_hash` | Hash of the referenced record's canonical content. |
| `prev_hash` | The previous entry's `entry_hash` (empty at the genesis entry). |
| `entry_hash` | Hash committing to this entry **and** `prev_hash`. |

Because each entry commits to the previous entry's hash, editing any earlier entry
invalidates every entry after it. Operators inspect and verify the chain through:

```http
GET /api/audit-chain                              # full chain (oldest first)
GET /api/audit-chain?approval_request_id=<id>     # one request's lifecycle
GET /api/audit-chain/verify                        # recompute and report integrity
```

`verify` walks the chain and confirms three things for every entry: it links to the
previous entry (`broken_link` otherwise), its stored fields still hash to its
`entry_hash` (`tampered_entry` otherwise), and its `payload_hash` still matches the
live source record (`tampered_payload` otherwise). It returns
`{ ok, length, broken_at, reason }`, reporting the first break. A source record
removed by retention is not treated as tampering. Like Decision Records, the audit
chain endpoints are operator-only.

## Approval replay (AGH-017)

Replay is a read-only, operator-only view that assembles the full lifecycle of one
approval into ordered steps so the operator can inspect exactly what happened:

```http
GET /api/agent-messages/<id>/replay                              # operator policy
GET /api/agent-messages/<id>/replay?redaction_profile=<profile>  # preview a surface
```

The response is `{ approval_request_id, redaction_profile, redacted, decided,
final_state, steps[], audit[], audit_verification }`. The `steps` array is ordered:

| Step | Source |
| --- | --- |
| `request_received` | The stored approval request (intent, action, authority, resources). |
| `risk_classified` | The risk and routing **persisted at submission** (`risk`, `interruption_policy`, `escalation_behavior`, timeout/etiquette), so the replay reflects what was actually shown rather than a recomputed guess. |
| `evidence_shown` | The evidence pack, bound to the same `request_hash`/`evidence_hash` the audit chain committed to. |
| `decision_made` | The latest Decision Record (decision, operator, authority grant, `decision_hash`). |
| `action_reported` | Each reported outcome, in forward order. |
| `final_state` | The latest outcome, else the decision (`approved`/`denied`), else the message status. |

`audit` is the request's chain segment and `audit_verification` is the chain
integrity result, so a tampered record is visible against the replay.

**Redaction follows operator policy.** When `redaction_profile` is omitted, the
primary operator card's profile is used. Only the `desktop_full` profile shows
private detail (message body, evidence-pack contents, decision/outcome comments);
any other profile (e.g. `mobile_lock_screen`) returns a redacted view that keeps the
lifecycle shape and the integrity hashes but withholds private content. Replay is
launch-only; an agent (MCP) token cannot read it, and an unknown id returns `404`.

## Governance export (AGH-018)

Operators export approval/audit history in a portable, redacted format for offline
review:

```http
POST /api/governance/export                               # redacted (default)
POST /api/governance/export  { "full": true, "confirm_full": true }  # full detail
```

The export is written as a `0o600` JSON file in the exports directory and the
response returns `{ ok, name, mode, audit_verification }`. The file is
`forgelink-governance-export-v1` and contains approval requests, decision records,
approval outcomes, the audit chain (hashes only), its verification, and
decision-memory rules.

**Redacted by default.** Credentials (MCP tokens, channel credentials) are never
included. Message bodies, evidence packs, decision comments, and outcome summaries
are excluded and listed under `excludes`. A **full** export includes that private
detail and therefore requires explicit operator confirmation: `full: true` without
`confirm_full: true` is rejected with `400`. Governance export is launch-only.

## Redaction profiles (AGH-022)

Replay redaction — and any other surface that shows an evidence pack or a
notification — renders through a named **redaction profile** that decides how much
each surface may reveal:

| Profile | Evidence | Body | Use |
| --- | --- | --- | --- |
| `desktop_full` | full | shown | The operator desktop; full evidence. |
| `mobile_lock_screen` | summary only | hidden | Paired mobile lock screen. |
| `email_summary` | summary + resources | hidden | Email surface. |
| `sms_fallback` | minimal | hidden | SMS fallback. |
| `status_only` | none | hidden | Status/Discord-style surfaces. |

An unknown profile id **fails closed** to the most restrictive profile, so a typo
never over-discloses. The replay endpoint (AGH-017) resolves the profile from the
operator card or the `redaction_profile` query parameter and renders evidence,
body, and decision/outcome comments accordingly. Operators inspect and preview
profiles with:

```http
GET  /api/redaction-profiles               # list canonical profiles
POST /api/redaction-profiles/preview       # { profile, evidence_pack?, notification? }
```

## Boundaries

- The chain covers approval requests, evidence packs, decisions, and outcomes.
- Replay and governance export are derived, read-only views over already-stored
  governance records; neither changes state or grants authority.
- Redaction profiles drive replay redaction and any evidence/notification surface;
  the profile is selected per operator card or per request.
