# Work Ledger

ForgeLink uses RepoPact work items as its durable product, engineering, and agent-coordination ledger.

This directory is not a casual TODO list. It is the authoritative record of durable work: what is being changed, why it exists, what counts as done, what evidence is required, and which parts of the system are allowed to move.

The pre-ledger `todos/` tree has been migrated into this ledger. Its original production-readiness plan is now tracked as:

```text
work/active/011-production-readiness/
```

All new cross-cutting product, architecture, security, data, release, provider, or agent-facing work starts here before implementation begins.

## Purpose

The work ledger exists to keep ForgeLink safe under agentic development.

It provides:

- stable work IDs that can be referenced by humans, agents, commits, audits, and release notes;
- explicit scope boundaries before code changes begin;
- pending acceptance criteria before implementation starts;
- lifecycle state that validators and dashboards can inspect;
- durable evidence for what was tested, reviewed, deferred, or rejected;
- separation between planning, implementation, evidence, and closeout;
- a local coordination surface that survives conversation loss, agent handoff, and long-running work.

ForgeLink should be able to answer:

- What work is active?
- Who or what owns it?
- What scopes may change?
- What must be true before the item can close?
- What evidence proves it?
- What risks remain?
- Which decisions shaped the result?

If the answer matters after the current conversation ends, it belongs in the ledger.

## Directory Layout

Work items are grouped by lifecycle state.

```text
work/
  README.md

  active/
    NNN-kebab-case/
      README.md
      work-item.json
      AGENTS.md
      _audit/                 optional
      local-artifacts/        optional

  deferred/
    NNN-kebab-case/
      README.md
      work-item.json
      AGENTS.md               optional

  completed/
    NNN-kebab-case/
      README.md
      work-item.json
      AGENTS.md               optional
      _audit/                 optional
```

The directory containing a work item is authoritative for lifecycle state. The `work-item.json` status must agree with the directory.

For example:

```text
work/active/015-communication-channels-and-voice/work-item.json
```

must contain:

```json
"status": "active"
```

## Work Item Anatomy

Each work item directory contains:

- `README.md` Human-readable intent, background, decisions, scope, acceptance, sequencing, evidence log, and closeout narrative.
- `work-item.json` Machine-readable lifecycle state used by validators, dashboards, and agents.
- `AGENTS.md` Local instructions for agents working inside that item. This file may narrow scope, require checks, define safety rules, and clarify what counts as done.
- Optional local artifacts Artifacts too specific to belong in central evidence, such as local audits, inventories, design sketches, fixture descriptions, or narrow migration notes.

The README explains the work. The JSON tracks lifecycle. The `AGENTS.md` governs agent behavior inside the item.

## Naming and IDs

Directory names use:

```text
NNN-kebab-case
```

Examples:

```text
011-production-readiness
015-communication-channels-and-voice
016-agent-human-governance
017-operator-cockpit-and-native-experience
```

IDs are permanent and never reused.

If an item is abandoned, superseded, merged, split, or rejected, keep its ID and record the outcome. Do not recycle the number.

## Current Active Work

As of the current ledger update, the main active product arcs are:

```text
011-production-readiness
```

Turns the original Twilio Phone / ForgeLink application into a secure, installable, recoverable Windows desktop messaging application with predictable operations and trustworthy releases. Its only remaining baseline gate is release/distribution strategy unless additional evidence is added.

```text
015-communication-channels-and-voice
```

Defines the ForgeLink-owned communications runtime, provider-neutral channels, telecom edge adapters, rich contact metadata, restored voice capability, mobile companion protocol direction, local-only operation, provider conformance testing, schema-migration coordination, and direct-telecom research.

```text
016-agent-human-governance
```

Defines the agent-human governance layer: Human Cards, agent identity, evidence packs, approval templates, risk tiers, decision memory, audit/replay, communication firewall, redaction profiles, external contact consent, untrusted-agent-content handling, key management, and ForgeWire Fabric HITL routing through ForgeLink.

```text
017-operator-cockpit-and-native-experience
```

Defines the product experience that makes ForgeLink an operator cockpit: Decisions/People/Agents/Channels navigation, triage lanes, operator modes, presence, mobile companion UX, batching, fatigue budget, reputation UI, summaries, scoped MCP resources, sample workspace, public demo, semantic-summary safety, and distribution/update strategy.

## Lifecycle States

### Active

Use `work/active/` for work that is currently authorized, planned, and available for implementation.

Active work must have:

- a stable ID;
- pending acceptance criteria;
- affected scopes;
- preflight marker if ID is `010` or later;
- enough narrative for a future agent to continue safely.

### Deferred

Use `work/deferred/` for work that is real but intentionally not active.

Deferred work must explain:

- why it exists;
- why it is deferred;
- what would reactivate it;
- what scopes it may affect later;
- what must not be implemented yet.

### Completed

Use `work/completed/` only when the work is genuinely done.

Completed work must include:

- satisfied acceptance criteria;
- waived criteria with reasons where applicable;
- evidence;
- commands run;
- tests or inspections performed;
- documentation updates;
- limitations;
- rollback notes where relevant;
- remaining risks.

Do not move a work item to `completed/` merely because implementation stopped. If unfinished, leave it active or defer it with a clear reason.

## Preflight Rule

Numbered implementation work must be added to the work ledger before coding, testing, docs, release, or repo mutation starts.

The first change for a new durable body of work is creating its:

```text
work/active/NNN-kebab-case/
```

or:

```text
work/deferred/NNN-kebab-case/
```

with pending acceptance criteria.

Work items `010` and later must include:

```json
"preflight": {
  "created_before_work_started": true,
  "created_at": "YYYY-MM-DDTHH:MM:SSZ",
  "note": "Created before implementation work started."
}
```

Items `000` through `009` are legacy with respect to this marker.

Work items `008` and `009` were completed with retroactive ledger handling. Work item `010` introduced the guardrail so that miss is visible and not repeated.

## Required `work-item.json` Shape

Each `work-item.json` should follow the repository schema and include at least:

```json
{
  "$schema": "../../../schemas/work-item.schema.json",
  "id": "NNN",
  "title": "Human Readable Title",
  "status": "active",
  "owner_scope": "work",
  "affected_scopes": [],
  "depends_on": [],
  "preflight": {
    "created_before_work_started": true,
    "created_at": "YYYY-MM-DDTHH:MM:SSZ",
    "note": "Created before implementation work started."
  },
  "acceptance_criteria": [],
  "created": "YYYY-MM-DD",
  "updated": "YYYY-MM-DD"
}
```

Acceptance criteria should use stable IDs.

Example:

```json
{
  "id": "CLV-001",
  "text": "Define the ForgeLink-owned local communications runtime.",
  "state": "pending",
  "evidence": []
}
```

Allowed criterion states are defined by `schemas/work-item.schema.json`:

```text
pending
satisfied
waived
```

Use `pending` for work not yet proven, `satisfied` for completed work with evidence, and `waived` for work intentionally absorbed, superseded, or rejected with a recorded reason.

## README Expectations

Each work item README should include:

- frontmatter;
- title;
- goal;
- background or lineage;
- product or architecture framing;
- non-goals;
- priority order;
- acceptance details;
- security/privacy constraints where relevant;
- documentation requirements;
- cross-cutting definition of done;
- evidence log.

Recommended frontmatter:

```md
---
audience: maintainers and implementation agents
status: active
last_verified: YYYY-MM-DD
source_of_truth: README.md; work-item.json
---
```

## `AGENTS.md` Expectations

A work item `AGENTS.md` should tell implementation agents:

- what this item owns;
- what it does not own;
- what related work items it must coordinate with;
- required checks;
- safety/security rules;
- definition of done.

Agents must read the root `AGENTS.md` and every nested `AGENTS.md` from the repository root down to the files they touch.

Nested instructions may narrow scope. They may not weaken root invariants.

## Scope Control

Every work item must declare affected scopes.

Examples:

```text
work
backend
desktop
ui
data
security
providers
contacts
voice
messaging
mobile
local-runtime
mcp
agents
policy
audit
docs
tooling
release
demo
```

Agents should not mutate scopes outside the work item unless:

1. the work item already authorizes that scope;
2. another active work item authorizes that scope;
3. the agent updates the ledger first; or
4. the operator explicitly approves the expansion.

## Acceptance Criteria

Acceptance criteria are the contract between the plan and implementation.

Good criteria are:

- specific;
- testable;
- scoped;
- stable;
- evidence-bearing.

Avoid vague criteria such as:

```text
Improve the UI.
Make it better.
Clean things up.
```

Prefer:

```text
Add keyboard-accessible triage lanes for needs-decision, waiting-on-agent,
informational, failed, muted, expired, and completed states, with renderer tests
covering lane transitions.
```

## Evidence

Evidence should be attached to the relevant acceptance criterion and summarized in the README evidence log.

Evidence may include:

- test commands;
- validation commands;
- visual smoke results;
- schema migration tests;
- security inspection notes;
- packaged app checks;
- manual verification;
- screenshots using synthetic/redacted data;
- release artifacts;
- audit reports.

Evidence must not include:

- real credentials;
- real phone numbers;
- real private messages;
- real contacts;
- real call SIDs;
- real provider account IDs;
- private screenshots;
- secret-bearing logs.

## Security and Privacy Rule

ForgeLink handles sensitive human communication state.

Work items that touch contacts, messages, calls, approvals, agents, providers, credentials, diagnostics, exports, or screenshots must explicitly state their security and privacy constraints.

Default rule:

```text
No credentials or personal communication data in commits, tests, fixtures,
screenshots, diagnostics, or default logs.
```

Provider credentials must remain encrypted or protected by the approved secure settings path.

Local private routes must remain authenticated.

Provider webhooks must retain signature validation or equivalent authenticity checks.

## Documentation Rule

Shipped behavior belongs in `docs/`.

Future behavior belongs in work items until implemented.

Do not document planned behavior as if it already ships.

When a criterion closes, update docs if the behavior is user-facing, operator-facing, security-sensitive, provider-facing, or relevant to future agents.

## Validation

After ledger changes, run the repository validator:

```text
python .local/validate_system.py
```

If RepoPact is available directly, this should also pass:

```text
repopact validate
```

Implementation work should also run the tests named by the relevant work item. Do not close criteria based on code inspection alone.

## Moving Work Between States

To move active work to completed:

1. ensure all required acceptance criteria are satisfied, waived with reason, or split into another work item;
2. update evidence;
3. update README closeout notes;
4. update `work-item.json` status;
5. move the directory to `work/completed/`;
6. run validation.

To defer work:

1. explain why it is deferred;
2. record what would reactivate it;
3. update `work-item.json` status;
4. move the directory to `work/deferred/`;
5. run validation.

Do not silently delete work items.

## Splitting Work

If an item grows too large, split it.

The original item should record:

- what was split out;
- new work item IDs;
- whether the original still owns any scope;
- dependency direction.

Example split:

```text
015-communication-channels-and-voice
  -> 016-agent-human-governance
  -> 017-operator-cockpit-and-native-experience
```

Splitting is preferred over turning one work item into an unbounded roadmap.

## Dependency Rule

Use `depends_on` when work requires another item’s architecture, schema, or decision boundary.

Examples:

```json
"depends_on": ["015"]
```

or:

```json
"depends_on": ["015", "016"]
```

Dependencies do not mean work must be implemented strictly sequentially, but they do mean agents must respect the upstream item’s boundaries and decisions.

## Agent Handoff Rule

A work item should contain enough information for a future agent to continue without needing the original conversation.

That means:

- no hidden assumptions;
- no “as discussed above” without summary;
- no unrecorded decisions;
- no acceptance criteria that depend on memory outside the repo.

If a conversation produced a decision, put it in the work item or in `decisions/`.

## Public Narrative Rule

ForgeLink’s public identity should not be defined by implementation providers.

Twilio, Telnyx, Plivo, Bandwidth, WhatsApp, Discord, email, RSS, push, and future mobile companion channels are adapters.

ForgeLink’s product center is:

```text
local-first human attention, authority, communication, and agent governance
```

Work items should preserve this distinction.

## Current Strategic Arc

The current ledger points toward this architecture:

```text
ForgeLink Core
  local communication runtime
  contact identity
  agent identity
  human authority
  approval lifecycle
  evidence packs
  decision memory
  attention policy
  communication firewall
  audit/replay
  data safety

Native Surfaces
  desktop cockpit
  local notifications
  mobile companion
  local agent bridge

Adapters
  SMS/MMS telecom edge
  voice telecom edge
  email
  push
  Telegram
  WhatsApp
  Discord
  RSS
  future channels
```

The core must remain useful without telecom providers.

Telecom providers are edge adapters when ForgeLink needs to reach the ordinary phone network.

## Minimal New Work Item Checklist

Before starting a new durable work item, create:

```text
work/active/NNN-kebab-case/
  README.md
  work-item.json
  AGENTS.md
```

Then confirm:

- [ ] ID is unused.
- [ ] Directory name matches `NNN-kebab-case`.
- [ ] `work-item.json` status matches directory state.
- [ ] Preflight marker exists for `010+`.
- [ ] Affected scopes are listed.
- [ ] Dependencies are listed.
- [ ] Acceptance criteria are pending and evidence-ready.
- [ ] Security/privacy constraints are stated if relevant.
- [ ] Required checks are stated.
- [ ] Validation passes.

## Closing Principle

The ledger is ForgeLink’s memory for serious work. If a change affects architecture, security, data, providers, agents, human attention, releases, or user trust, it starts here.
