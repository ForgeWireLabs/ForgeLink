---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-23
source_of_truth: work/active/016-agent-human-governance/README.md; work/active/016-agent-human-governance/work-item.json
---

# Work Item 016: Agent-Human Governance

> Lifecycle state for this item lives in [`work-item.json`](work-item.json); this
> README is the intent, scope, sequencing, and closeout narrative. This item
> captures the governance primitives that make ForgeLink more than a messaging
> app: resolvable human authority, trusted agent identity, evidence-bearing
> approval requests, tamper-evident decisions, and a communication firewall
> between agents and the outside human world.

## Goal

Make ForgeLink the local operating boundary where autonomous systems request
human attention, authority, and decisions safely, respectfully, and auditably.

This work item defines the agent-human governance layer. Channels remain
adapters. Providers remain edge services. The durable product center is the
governed relationship between:

- a human operator;
- trusted or untrusted agents;
- requested actions;
- evidence;
- risk;
- authority;
- decisions;
- outcomes;
- future policy.

## Product thesis

ForgeLink should answer questions ordinary messaging apps cannot answer:

- Who is the human authority?
- Which agents are allowed to ask for attention?
- What exactly is being requested?
- What evidence was shown?
- What authority is being granted?
- What happens if the human says no?
- What happens if the human does not answer?
- What action happened after approval?
- Can the decision be replayed later?
- Can repeated decisions become explicit policy?
- Can agents be prevented from contacting external humans directly?

If ForgeLink answers those questions, it is not a Twilio client, a chat app, or
a notification panel. It is human-boundary infrastructure.

## Relationship to Work Item 015

Work item 015 owns the local communications runtime, channels, telecom edge
adapters, contact metadata, mobile companion protocol foundation, and voice/call
surface.

This item owns the governance semantics that ride on top of that runtime:

- human/operator identity;
- agent identity and trust;
- approval request schema;
- evidence packs;
- risk classification;
- decision records;
- signed/tamper-evident audit;
- outcome callbacks;
- communication firewall rules;
- redaction policy;
- consent for external contact.

## Non-goals

- Do not implement new SMS/MMS/voice providers here; use item 015.
- Do not implement the full mobile companion here; use item 015/017.
- Do not add Matrix support.
- Do not weaken local API authentication.
- Do not allow arbitrary agents to contact external humans directly.
- Do not store real credentials, real private messages, real phone numbers, or
  real call records in tests/fixtures.
- Do not make adaptive policy changes without explicit operator confirmation.
- Do not claim cryptographic non-repudiation beyond what is actually implemented.

## Priority order

### Phase 0: Resolvable human authority

- [x] **AGH-001 Add Human Cards.** Define a local-first `HumanCard` or equivalent
  operator identity record that lets agents address human authority by role, not
  just by phone number or contact string.
  - Include: display name, role, availability, authority scope, preferred
    channels, quiet hours, escalation rules, approval capabilities, redaction
    preferences, contact points, and device keys.
  - Acceptance: Agents can resolve local aliases such as `operator:primary`,
    `operator:release_approval`, `operator:security_approval`, and
    `operator:emergency_only`.
  - Acceptance: Human Cards are local data and are not published externally by
    default.

- [x] **AGH-002 Add authority scopes.** Model what each human/operator identity is
  allowed to approve.
  - Acceptance: Approval requests declare required authority scope.
  - Acceptance: ForgeLink rejects or escalates requests addressed to humans who
    lack the required authority.
  - Acceptance: Single-operator use remains simple; multi-operator authority is
    schema-compatible but not required to ship in the first slice.

### Phase 1: Agent identity and trust

- [x] **AGH-003 Add Agent Identity Registry.** Add first-class identities for
  agents, systems, MCP clients, and local workflow sources.
  - Include: agent ID, display name, owner, repo/app/source, signing key or
    stable local identity, allowed tools/channels, default risk limit,
    escalation contact, last seen, and trust state.
  - Acceptance: Agent-originated requests are tied to an identity.
  - Acceptance: Unknown agents have restricted defaults.

- [x] **AGH-004 Add agent trust states and probation.** Support trust/reputation
  states for agents.
  - Example states: unknown, probation, trusted, restricted, muted, blocked.
  - Acceptance: New agents default to conservative approval requirements.
  - Acceptance: Muted or blocked agents cannot interrupt.
  - Acceptance: Trust changes are explicit operator decisions and are audited.

- [x] **AGH-005 Add agent background-check checklist.** Define a local checklist
  for promoting agents to trusted status.
  - Include: source/repo, owner, allowed scopes, recent behavior, failed requests,
    denied requests, tool permissions, and last validation.
  - Acceptance: The UI or docs make agent trust review reproducible.

### Phase 2: Approval request schema and evidence packs

- [x] **AGH-006 Add structured approval request schema.** Replace vague approval
  prompts with a structured request object.
  - Required fields: intent, requested action, reason for interrupt, risk level,
    required authority, affected resources, expiration, default-on-timeout,
    deny behavior, and requested decision options.
  - Acceptance: Badly formed requests are rejected with actionable validation
    errors.

- [x] **AGH-007 Add Evidence Packs.** Add evidence-bearing approval requests.
  - Include: summary, affected resources, diff summary, proposed operation,
    commands/API calls where relevant, tests/checks, rollback plan, source links,
    and limitations.
  - Acceptance: An approval card can show what the human is approving without
    requiring the human to inspect raw agent logs.
  - Acceptance: Evidence packs are redacted per channel/profile.

- [x] **AGH-008 Add approval templates/playbooks.** Define reusable templates for
  common approval classes.
  - Initial templates: file write, delete data, git commit, GitHub release,
    public mirror sync, external message send, credential change, network access,
    payment/purchase, provider setting change.
  - Acceptance: Templates declare required fields, minimum evidence, default risk,
    timeout behavior, allowed decision options, rollback requirement, and audit
    requirement.

- [x] **AGH-009 Add approval dry-run/simulation.** Let agents ask ForgeLink how a
  request would be classified before interrupting the human.
  - Acceptance: Dry-run returns whether approval is required, estimated risk,
    missing evidence, preferred channel, batching/defer recommendation, and
    validation errors.

### Phase 3: Risk, interruption, escalation

- [x] **AGH-010 Add risk-tiered interruption policy.** Define consequence-based
  levels for agent requests.
  - Suggested levels: log only, passive notification, normal approval, urgent
    interrupt, fail-closed critical approval, multi-party approval/cannot proceed.
  - Acceptance: Request routing is determined by risk, authority, contact policy,
    operator mode, and agent trust.

- [x] **AGH-011 Add explicit timeout and escalation behavior.** Every approval
  class must define what happens when the human does not answer.
  - Options: deny by default, defer, retry later, escalate to another channel,
    escalate to another operator, or fail closed.
  - Acceptance: Expired requests are visible and audit-recorded.

- [x] **AGH-012 Add agent etiquette protocol.** Require agents to explain why they
  are interrupting and whether the request can wait or batch.
  - Required fields: urgency, reason for interrupt, expected response time,
    what-if-no-response, can-batch, can-wait-until.
  - Acceptance: ForgeLink can reject or downgrade interruptions that lack
    etiquette fields.

### Phase 4: Decision records and learning

- [x] **AGH-013 Add Decision Records.** Persist what the human saw and decided.
  - Include: request ID, request hash, evidence hash, operator identity, device
    identity where available, decision, timestamp, selected options, comments,
    and resulting authority grant.
  - Acceptance: A completed decision can be replayed later.

- [ ] **AGH-014 Add Decision Memory.** Convert repeated human decisions into
  suggested future policy.
  - Acceptance: ForgeLink can detect repeated approval patterns.
  - Acceptance: Suggested rules require explicit operator confirmation.
  - Acceptance: Decision memory never silently expands agent authority.

- [ ] **AGH-015 Add outcome callbacks.** Require agents to report what happened
  after approval.
  - States: approved, action started, action succeeded, action failed, expired
    before use, used with modified scope, cancelled.
  - Acceptance: Dangling approvals are visible.
  - Acceptance: Scope mismatch is flagged as an audit issue.

### Phase 5: Audit, replay, and integrity

- [x] **AGH-016 Add tamper-evident local audit chain.** Add lightweight
  hash-linked records for approval requests, evidence packs, decisions, and
  outcomes.
  - Acceptance: Audit records can detect local mutation after the fact.
  - Acceptance: Implementation is local and practical; do not introduce
    blockchain or remote attestation claims.

- [ ] **AGH-017 Add approval replay.** Add a way to inspect the full lifecycle of
  a completed approval.
  - Replay steps: request received, risk classified, evidence shown, decision
    made, action started, outcome reported, final state.
  - Acceptance: Replay view redacts according to operator policy.

- [ ] **AGH-018 Add governance export.** Export approval/audit history in a
  redacted portable format for review.
  - Acceptance: Export excludes credentials and private message bodies by
    default.
  - Acceptance: Full export requires explicit operator confirmation.

### Phase 6: Communication firewall and consent

- [ ] **AGH-019 Add communication firewall rules.** Let the operator define how
  agents may communicate with humans and external channels.
  - Example rules: agents may only draft external messages; external send
    requires approval; agents may contact operator locally; agents may escalate
    to SMS only if urgent; agents may never send MMS; agents may not call phone
    numbers.
  - Acceptance: Rules are enforced before channel dispatch.

- [ ] **AGH-020 Add draft-don't-send mode.** For external channels, support safe
  drafting as the default.
  - Acceptance: Agent drafts can be reviewed, edited, approved, denied, or sent
    by the operator.
  - Acceptance: Direct-send authority is explicit and audited.

- [ ] **AGH-021 Add external-contact consent ledger.** Track whether agents may
  contact a given external human/contact.
  - Include: allowed topics, allowed channels, allowed hours, requires review,
    consent source, and last review.
  - Acceptance: Unknown external contacts default to no direct agent contact.

- [ ] **AGH-022 Add redaction profiles.** Define what request details are allowed
  on each channel/surface.
  - Examples: desktop full evidence, mobile lock-screen redacted, SMS fallback
    minimal, email summarized, Discord/status-only.
  - Acceptance: Evidence packs and notifications use the selected redaction
    profile.

### Phase 7: Boundary hardening, key management, and agent contract (added 2026-06-18 gap review)

- [ ] **AGH-023 Harden public ingress / tunnel boundary.** Reconcile the automatic public webhook tunnel (item 014) with private-first: document the inbound attack surface, ensure only signature-validated provider requests reach handlers, rate-limit and lock down exposed webhook routes, scope what the tunnel exposes, and record a decision on the boundary. See decision 0003.
- [ ] **AGH-024 Treat agent-supplied content as untrusted.** Evidence packs, approval text, and agent messages are untrusted input: labeled agent-provided/unverified, never auto-executed or auto-trusted, sanitized, with an approval surface that resists spoofed system text, fabricated urgency, and look-alike operator prompts.
- [ ] **AGH-025 Define decision/audit key management.** Key and device-key generation, OS-backed storage, rotation, lost-device revocation, and recovery behind decision signing and the tamper-evident chain; state the real integrity guarantee.
- [ ] **AGH-026 Specify the agent-facing governance contract.** How agents submit a request, await a decision, and receive the outcome, mapped onto the MCP bridge and ForgeWire Fabric dispatch/await_result, including timeouts, deferral, and outcome reporting. See decision 0004.
- [ ] **AGH-027 Add an end-to-end governance-loop integration test.** request -> risk -> evidence -> decision -> outcome -> audit -> replay, proving the lifecycle holds together beyond unit tests.

- [ ] **AGH-028 Pipe Fabric HITL approvals through ForgeLink.** When ForgeLink is installed and reachable, ForgeWire Fabric's human-in-the-loop approval pane automatically routes approvals to ForgeLink as the governed decision surface (evidence packs, audit, redaction, mobile companion), with an explicit operator opt-out and graceful fallback to Fabric's built-in pane when ForgeLink is absent. See decision 0004.

## Suggested data model direction

This is a planning target, not a required literal schema.

```text
human_cards
  id
  alias
  display_name
  role
  availability
  authority_scopes_json
  preferred_channels_json
  redaction_profile_id
  quiet_hours_policy_id
  escalation_policy_id
  created_at
  updated_at

agent_identities
  id
  display_name
  source_kind
  source_uri
  owner
  signing_key_ref
  trust_state
  default_risk_limit
  allowed_channels_json
  allowed_tools_json
  escalation_human_card_id
  last_seen_at
  created_at
  updated_at

approval_requests
  id
  agent_identity_id
  human_card_id
  template_id
  intent
  requested_action
  risk_level
  required_authority
  affected_resources_json
  expires_at
  default_on_timeout
  status
  request_hash
  created_at
  updated_at

evidence_packs
  id
  approval_request_id
  summary
  evidence_json
  rollback_plan
  limitations
  evidence_hash
  created_at

decision_records
  id
  approval_request_id
  operator_human_card_id
  device_id
  decision
  decision_comment
  request_hash
  evidence_hash
  decision_hash
  decided_at

approval_outcomes
  id
  approval_request_id
  agent_identity_id
  outcome_state
  outcome_summary
  scope_match
  reported_at

communication_firewall_rules
  id
  agent_identity_id
  contact_id
  channel_kind
  rule_kind
  policy_json
  enabled
  created_at
  updated_at

consent_ledger
  id
  contact_id
  agent_identity_id
  allowed_topics_json
  allowed_channels_json
  consent_source
  requires_review
  last_reviewed_at
  created_at
  updated_at
```

## Security and privacy constraints

- No real credentials, contact data, message bodies, phone numbers, provider IDs,
  or private evidence in fixtures.
- Renderer-visible governance state must be scoped and redacted.
- Agent requests must not gain authority merely by being well-formed.
- Adaptive policy suggestions must require operator confirmation.
- Audit exports must default to redacted mode.
- Human Cards are local operator records, not public identity documents unless a
  future item explicitly designs a sharing boundary.

## Documentation requirements

Add or update docs for:

- Human Cards and operator aliases;
- agent identity registry;
- approval request schema;
- evidence packs;
- approval templates/playbooks;
- risk tiers;
- decision memory;
- outcome callbacks;
- tamper-evident local audit;
- communication firewall;
- redaction profiles;
- external contact consent.

## Cross-cutting definition of done

- Every shipped governance primitive has tests and docs.
- Existing local-only and SMS/MMS flows still work.
- Existing MCP bridge behavior is preserved or intentionally migrated with docs.
- Security-sensitive claims have reproducible evidence.
- Every closed criterion records commands run, evidence, limitations, and rollback
  notes.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-18 | planning | Deep product review identified governance primitives needed to make ForgeLink human-boundary infrastructure rather than a messaging wrapper | Created item 016 before implementation starts. |
| 2026-06-18 | gap review | Roadmap gap review with operator: local-only onboarding, public-tunnel hardening, untrusted agent content, key management, agent-facing contract, conformance/integration testing, migration coordination, and distribution/updates | Added acceptance criteria and fixed README acceptance-criteria numbering to match work-item.json. |
| 2026-06-22 | AGH-001 complete | Human Cards: schema v11 `human_cards` (per decision 0011 allocation table) seeding `operator:primary`; backend `humanCards`/`humanCardByAlias`/`resolveHumanCard`/`upsertHumanCard`/`deleteHumanCard`; launch-only management API + agent-reachable redacted `GET /api/human-cards/resolve` (mcp-safe) with `operator:*`→primary fallback; `docs/human-cards.md`; DB + HTTP tests + v11 from-previous-shipped-schema upgrade assertion (79 backend tests green) | AGH-001 satisfied (evidence 20260622-agh001-human-cards). Authority scopes (AGH-002) build on the stored `authority_scopes`. |
| 2026-06-22 | AGH-002 complete | Authority scopes: canonical `AUTHORITY_SCOPES` (general/release/security/emergency); `checkAuthority(alias,scope)` returns grant + escalation targets, with `humanCardsWithAuthority`; agent-reachable dry-run `GET /api/authority/check` (mcp-safe, 400 on unknown scope); ingestion gate enforces optional `required_authority`+`to_human` (403 `insufficient_authority` + escalation when the addressed human lacks the scope), backward compatible; seeded `operator:primary` holds all scopes so single-operator stays simple; `docs/human-cards.md` authority section; DB + HTTP tests (81 backend tests green) | AGH-002 satisfied (evidence 20260622-agh002-authority-scopes). Required scope is enforced at ingestion but persisted with the approval schema (AGH-006). Agent Identity Registry (AGH-003) is next. |
| 2026-06-22 | AGH-003 complete | Agent Identity Registry: schema v12 `agent_identities` (per decision 0011); `recordAgentIdentitySeen` auto-registers unknown agents with restricted defaults (trust_state `unknown`, empty allow-lists) and bumps last-seen; `upsertAgentIdentity` for operator management with validated trust state; `agentIdentities`/`agentIdentity`; agent message ingestion now ties each request to an identity and echoes `{ agent: { id, trust_state } }`; launch-only `GET/POST /api/agent-identities`; `docs/agent-identity.md`; DB + HTTP tests + v12 upgrade assertion (83 backend tests green) | AGH-003 satisfied (evidence 20260622-agh003-agent-identity-registry). Trust-state transitions/probation are AGH-004 (next); per-message identity persistence is AGH-006. |
| 2026-06-22 | AGH-004 complete | Agent trust states + probation: schema v13 `agent_trust_events` (per decision 0011) auditing every transition (from/to/reason); `setAgentTrustState` (explicit, audited; no-op + not-found guarded) and `agentTrustEvents`, with `upsertAgentIdentity` trust changes also audited; ingestion enforces muted/blocked agents cannot interrupt (403 `agent_muted`/`agent_blocked`) and only trusted agents may urgent-interrupt (403 `insufficient_trust_for_urgent`, new agents stay conservative); launch-only `POST /api/agent-identities/:id/trust` + `GET .../trust-events`; `docs/agent-identity.md` trust section; DB + HTTP tests + two pre-existing agent tests updated for the trust gate + v13 upgrade assertion (85 backend tests green) | AGH-004 satisfied (evidence 20260622-agh004-agent-trust-states). Phase 1 continues with AGH-005 (agent background-check checklist). |
| 2026-06-22 | AGH-005 complete | Agent background-check checklist: `docs/agent-identity.md` now gives operators a reproducible trust-promotion review covering source/repo/app, owner, allowed scopes/channels/tools, recent behavior, failed and denied requests, tool permissions, last validation, and promotion/restriction/mute/block guidance. | AGH-005 satisfied (evidence 20260622-agh005-agent-background-check). This is docs-only; AGH-006 is next for the structured approval request schema. |
| 2026-06-22 | AGH-006 complete | Structured approval requests: schema v14 adds durable request fields on `agent_messages` (`intent`, `requested_action`, `reason_for_interrupt`, `risk`, `required_authority`, `to_human`, `affected_resources`, `timeout_behavior`, `deny_behavior`, `decision_options`); agent-channel ingestion now rejects incomplete `approval_request` payloads with 400, persists the structured fields, and keeps AGH-002 authority gating; `docs/approval-requests.md`; renderer type updated; DB + HTTP tests cover v14 migration, persistence, validation, and API round-trip (85 backend tests green). | AGH-006 satisfied (evidence 20260622-agh006-structured-approval-requests). Evidence Packs (AGH-007) are next. |
| 2026-06-22 | AGH-007-009 complete | Evidence packs/templates/dry-run: schema v15 adds `template_id` and `evidence_pack` to `agent_messages`; `approval_request` submissions require bounded evidence packs with summary/resources/diff/proposed operation/checks/rollback/links/limitations/redaction profile; `GET /api/approval-templates` exposes file-write/data-delete/git-commit/GitHub-release/mirror-sync/external-message/credential-change/network-access/purchase/provider-setting playbooks; `POST /api/approval-requests/dry-run` returns approval-required, estimated risk, missing evidence, preferred channel, batching/defer recommendation, validation errors, template, and authority simulation without persisting or interrupting; `docs/approval-requests.md`; DB + HTTP tests cover v15 migration, persistence, templates, and dry-run (85 backend tests green). | AGH-007, AGH-008, and AGH-009 satisfied (evidence 20260622-agh007-009-evidence-templates-dry-run). Risk-tiered interruption policy (AGH-010) is next. |
| 2026-06-23 | AGH-010-012 complete | Phase 3 risk/timeout/etiquette: schema v16 adds `interruption_policy`, `escalation_behavior`, `expected_response_time`, `no_response_behavior`, `can_batch`, `can_wait_until`, and `agent_message_events`; dry-run and submit paths classify requests across log-only/passive/normal/urgent/fail-closed/multi-party states using risk, urgency, authority, contact policy, operator mode, and trust; approval requests require etiquette fields; expired requests are visible and audit-recorded; `GET /api/agent-messages/:id/events`; `docs/approval-requests.md`; DB + HTTP tests cover v16 migration, routing, etiquette persistence, dry-run policy output, and expiry audit events (85 backend tests green). | AGH-010, AGH-011, and AGH-012 satisfied (evidence 20260623-agh010-012-phase3-risk-timeout-etiquette). Decision records (AGH-013) are next. |
| 2026-06-23 | AGH-013 complete | Decision Records: schema v17 `decision_records` (per decision 0011) stores the deciding operator alias + device, decision, selected options, comment, granted authority, and `request_hash`/`evidence_hash`/`decision_hash`; `recordDecision` binds the record to the stored request and evidence, grants only the request's declared authority on a non-denial (none on deny), and audits a `decision` event; operator approve/dismiss on approval requests write a record from the launch surface only (an agent/MCP token cannot forge one); operator-only `GET /api/decision-records` and `GET /api/agent-messages/:id/decision` make a completed decision replayable; renderer `DecisionRecord` type; `docs/approval-requests.md`; decision records added to the durable export; DB + HTTP tests cover v17 migration, hashing/authority-grant, the decision event, replay endpoints, and agent-token rejection (86 backend tests green). | AGH-013 satisfied (evidence 20260623-agh013-decision-records). Phase 4 continues with Decision Memory (AGH-014). |
| 2026-06-23 | AGH-016 complete | Tamper-evident audit chain: schema v18 `audit_chain` (per decision 0011) is an append-only, hash-linked log; creating an approval request appends `approval_request` (+ `evidence_pack` when present) entries and recording a decision appends a linked `decision` entry, each committing to the previous entry's hash; `verifyAuditChain` walks the chain and reports the first `broken_link`/`tampered_entry`/`tampered_payload`, recomputing payloads from live records (a retention-deleted record is not flagged); the v17 decision-hash formula was factored into one `decisionHashOf` helper shared by the write path and verifier (raw NUL separators replaced with the `\u0000` escape, byte-identical); operator-only `GET /api/audit-chain[?approval_request_id=]` and `GET /api/audit-chain/verify`; renderer `AuditChainEntry`/`AuditChainVerification` types; chain added to the durable export; `docs/approval-requests.md`; DB + HTTP tests cover v18 migration, chain growth/linking, decision/entry tamper detection, and agent-token rejection (87 backend tests green). | AGH-016 satisfied (evidence 20260623-agh016-audit-chain). Chain covers requests/evidence/decisions now; outcome entries land with AGH-015. Returning to Phase 4: Decision Memory (AGH-014) and outcome callbacks (AGH-015). |
