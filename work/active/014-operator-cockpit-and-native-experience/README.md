---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-18
source_of_truth: README.md; work-item.json
---

# Work Item 014: Operator Cockpit and Native Experience

> Lifecycle state for this item lives in [`work-item.json`](work-item.json); this
> README is the intent, scope, sequencing, and closeout narrative. This item
> captures the product experience that makes ForgeLink feel like a state-of-the-art
> operator cockpit rather than a phone clone, chat app, or approval widget.

## Goal

Turn ForgeLink into the operator cockpit for human attention, agent decisions,
people, agents, channels, and native device presence.

Work item 013 defines the governance primitives. This item defines how those
primitives become a standout product:

- decision-first inbox;
- relationship-aware people/agents/channels layout;
- operator modes and availability;
- local presence signals;
- mobile companion as the first-party human decision terminal;
- triage lanes;
- batch approvals;
- fatigue budget;
- agent reputation;
- local semantic summaries;
- scoped MCP resources;
- emergency/crisis boundaries;
- a killer demo that proves the category.

## Product thesis

ForgeLink should not look or behave like a generic messages app. Its primary
surfaces should be:

```text
Decisions
People
Agents
Channels
```

The product should optimize for:

- fewer bad interruptions;
- better evidence when interruption is necessary;
- clear separation between informational messages and action-required decisions;
- safe agent communication;
- local-first privacy;
- fast human response from desktop or paired mobile device;
- durable replay of what happened.

## Relationship to Work Items 012 and 013

- Work item 012 owns the local communications runtime, channels, provider edges,
  contact metadata, voice, and mobile companion protocol foundation.
- Work item 013 owns governance primitives: Human Cards, agent identity,
  structured approval, evidence packs, risk tiers, decision records, audit,
  communication firewall, and redaction profiles.
- This item owns the operator experience: layout, triage, modes, presence,
  batching, fatigue, reputation, summaries, mobile decision UX, and demo polish.

## Non-goals

- Do not implement telecom provider logic here.
- Do not implement governance schemas here except as needed for UI integration.
- Do not add Matrix support.
- Do not expose private messages or approval evidence through broad MCP resources.
- Do not make the mobile companion a full chat clone in its first version.
- Do not use cloud summarization by default for private communications.

## Priority order

### Phase 0: Cockpit information architecture

- [ ] **OCX-001 Define decision-first navigation.** Rework the product
  information architecture around Decisions, People, Agents, and Channels.
  - Acceptance: Messages remain accessible, but action-required decisions are not
    buried inside ordinary conversations.
  - Acceptance: The UI separates communication, approvals, agent status, and
    channel configuration.

- [ ] **OCX-002 Add triage lanes.** Split the operator inbox into meaningful
  lanes.
  - Initial lanes: needs decision, waiting on agent, informational, failed/needs
    repair, muted, expired, completed.
  - Acceptance: Agent requests cannot flood the same lane as ordinary human
    messages.

- [ ] **OCX-003 Add relationship-aware grouping.** Present people and systems by
  relationship/trust rather than only alphabetical contact list.
  - Groups: operator, family, trusted humans, external contacts, agents, systems,
    unknown, blocked.
  - Acceptance: Unknown and blocked entities have visibly different treatment.

### Phase 1: Operator modes and presence

- [ ] **OCX-004 Add operator availability modes.** Add explicit modes that inform
  attention policy.
  - Suggested modes: available, focus, driving, sleeping, family, work,
    emergency-only, offline.
  - Acceptance: Mode affects routing, redaction, batching, and escalation.

- [ ] **OCX-005 Add local presence signals.** Use privacy-preserving local signals
  to improve attention routing.
  - Signals may include app focus, keyboard/mouse activity, system idle, battery,
    network, do-not-disturb, paired mobile proximity, and calendar integration if
    later approved.
  - Acceptance: Presence signals are local and visible/configurable.
  - Acceptance: No hidden surveillance behavior.

- [ ] **OCX-006 Add emergency/crisis rules.** Add hard boundaries for urgent and
  emergency behavior.
  - Include emergency contact bypass, repeated urgent escalation, agent emergency
    impersonation prevention, safety-sensitive language handling, and local-only
    fail-safe behavior.
  - Acceptance: Agents cannot mark requests as emergency without matching policy.

### Phase 2: Mobile companion experience

- [ ] **OCX-007 Define mobile companion MVP UX.** Keep the first mobile companion
  focused on human decisions rather than full chat.
  - Include: paired device, redacted alerts, approval cards, approve/deny, short
    reply, presence signal, emergency contact toggle, and device revoke.
  - Acceptance: Desktop remains source of truth.
  - Acceptance: Locked/mobile notification surfaces use redaction profiles.

- [ ] **OCX-008 Add mobile decision terminal flow.** Design the flow where a
  local agent request appears on mobile, receives a signed decision, and returns
  to desktop.
  - Acceptance: Flow supports approve, deny, defer, request more info, and short
    reply.
  - Acceptance: Mobile never needs full private database replication for the MVP.

### Phase 3: Reducing interruption cost

- [ ] **OCX-009 Add batch approvals.** Batch related low/medium-risk requests into
  one decision surface.
  - Acceptance: User can approve all, approve selected, deny all, or inspect
    individual items.
  - Acceptance: Batch approval preserves individual audit/outcome records.

- [ ] **OCX-010 Add human fatigue budget.** Track and use interruption pressure.
  - Metrics: interruptions today, urgent interruptions today, denied requests,
    expired requests, average response time, repeated interruptions by agent.
  - Acceptance: Policy can recommend batching, deferring, or muting when fatigue
    thresholds are exceeded.

- [ ] **OCX-011 Add agent reputation UI.** Surface whether agents are earning or
  losing trust.
  - Signals: approvals, denials, expired requests, malformed requests, failed
    outcomes, modified-scope attempts, repeated urgent requests.
  - Acceptance: Reputation informs UI and suggestions but does not silently grant
    authority.

### Phase 4: Summaries and scoped context

- [ ] **OCX-012 Add local semantic thread summaries.** Summarize long threads
  locally where feasible.
  - Include: what happened, open decisions, pending replies, last human action,
    and agent-relevant constraints.
  - Acceptance: Summaries are derived artifacts, not source of truth.
  - Acceptance: Cloud summarization is opt-in only if ever added.

- [ ] **OCX-013 Add scoped MCP resources.** Expose safe, minimal resources to MCP
  clients instead of raw communication dumps.
  - Examples: `get_pending_approvals`, `get_contact_summary`,
    `get_thread_summary`, `get_agent_status`.
  - Acceptance: No `dump_all_messages` style resource is available by default.
  - Acceptance: Resource access respects contact policy, redaction, and agent
    trust.

### Phase 5: External communication UX

- [ ] **OCX-014 Add reviewed outbox.** Provide a visible outbox for agent-drafted
  external messages.
  - Acceptance: Drafts can be reviewed, edited, approved, denied, scheduled, or
    sent.
  - Acceptance: The UI clearly distinguishes drafts from sent messages.

- [ ] **OCX-015 Add channel redaction previews.** Show what will be visible on
  each channel before dispatch.
  - Acceptance: Desktop, mobile, SMS, email, Discord/status, and other channels
    can preview their redacted payloads.

### Phase 6: Product demo and public credibility

- [ ] **OCX-016 Build the killer demo.** Create a reproducible local demo that
  explains ForgeLink in under two minutes.
  - Demo flow: Codex/ForgeWire requests approval to publish a GitHub release;
    ForgeLink shows evidence pack with tests, diff summary, version, release
    notes, and rollback; mobile companion gets redacted alert; operator approves;
    agent publishes; ForgeLink records outcome and replay.
  - Acceptance: Demo uses synthetic data.
  - Acceptance: Demo does not require live telecom credentials.

- [ ] **OCX-017 Add public-facing screenshots and narrative.** Prepare product
  assets that show ForgeLink as human-boundary infrastructure.
  - Acceptance: Screenshots are synthetic/redacted.
  - Acceptance: README/docs describe Decisions, People, Agents, Channels rather
    than leading with Twilio.

- [ ] **OCX-018 Add first-run sample workspace.** Provide an optional synthetic
  sample mode so new users can understand the product without real credentials.
  - Acceptance: Sample mode includes fake contacts, fake agents, fake approvals,
    fake outcomes, and fake channel states.
  - Acceptance: Sample data cannot be confused with real data.

## Suggested UI structure

```text
ForgeLink
  Decisions
    Needs decision
    Waiting on agent
    Expired
    Completed
  People
    Operator
    Family
    Trusted
    External
    Unknown
    Blocked
  Agents
    Trusted
    Probation
    Muted
    Blocked
    Health / reputation
  Channels
    Local desktop
    Mobile companion
    SMS/MMS edge
    Voice edge
    Email
    Push
    Chat
    Feeds
  Settings
    Attention policy
    Redaction profiles
    Data safety
    Diagnostics
```

## Security and privacy constraints

- Presence is local, transparent, and configurable.
- Mobile companion starts as a decision terminal, not a private-data mirror.
- Summaries are derived artifacts and must be deletable/rebuildable.
- MCP resources must be scoped and redacted.
- Demo/sample data must be obviously synthetic.
- Public screenshots must not contain real contacts, messages, provider IDs,
  phone numbers, approval evidence, or private system details.

## Documentation requirements

Add or update docs for:

- Decisions/People/Agents/Channels navigation;
- operator modes;
- presence signals;
- emergency behavior;
- mobile companion MVP UX;
- triage lanes;
- batch approvals;
- fatigue budget;
- agent reputation;
- local summaries;
- scoped MCP resources;
- reviewed outbox;
- demo/sample mode.

## Cross-cutting definition of done

- UI changes are covered by renderer interaction tests.
- Accessibility is considered for all new decision surfaces.
- Local-only mode works without telecom credentials.
- Redaction behavior is visible and testable.
- Demo/sample mode is synthetic and safe.
- Every closed criterion records commands run, evidence, limitations, and rollback
  notes.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-18 | planning | Deep product review identified operator cockpit features needed to make ForgeLink stand out as a state-of-the-art human-boundary app | Created item 014 before implementation starts. |
