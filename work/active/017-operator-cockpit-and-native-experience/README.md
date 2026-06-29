---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-29
source_of_truth: work/active/017-operator-cockpit-and-native-experience/README.md; work/active/017-operator-cockpit-and-native-experience/work-item.json
---

# Work Item 017: Operator Cockpit and Native Experience

> Lifecycle state for this item lives in [`work-item.json`](work-item.json); this
> README is the intent, scope, sequencing, and closeout narrative. This item
> captures the product experience that makes ForgeLink feel like a state-of-the-art
> operator cockpit rather than a phone clone, chat app, or approval widget.

## Goal

Turn ForgeLink into the operator cockpit for human attention, agent decisions,
people, agents, channels, and native device presence.

Work item 016 defines the governance primitives. This item defines how those
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

## Relationship to Work Items 015, 016, and 030

- Work item 015 owns the local communications runtime, channels, provider edges,
  contact metadata, voice, and mobile companion protocol foundation.
- Work item 016 owns governance primitives: Human Cards, agent identity,
  structured approval, evidence packs, risk tiers, decision records, audit,
  communication firewall, and redaction profiles.
- Work item 030 owns the Tauri 2 shared desktop/mobile shell and Electron
  retirement path. This item must shape the operator cockpit and mobile decision
  UX so the same UI can move into Tauri instead of becoming an Electron-only or
  throwaway mobile surface.
- This item owns the operator experience: layout, triage, modes, presence,
  batching, fatigue, reputation, summaries, mobile decision UX, and demo polish.

## Non-goals

- Do not implement telecom provider logic here.
- Do not implement governance schemas here except as needed for UI integration.
- Do not add Matrix support.
- Do not expose private messages or approval evidence through broad MCP resources.
- Do not make the mobile companion a full chat clone in its first version.
- Do not create a separate throwaway mobile shell or deepen Electron-only UI
  dependencies that block the Tauri 2 migration in work item 030.
- Do not use cloud summarization by default for private communications.

## Priority order

### Phase 0: Cockpit information architecture

- [x] **OCX-001 Define decision-first navigation.** Rework the product
  information architecture around Decisions, People, Agents, and Channels.
  - Acceptance: Messages remain accessible, but action-required decisions are not
    buried inside ordinary conversations.
  - Acceptance: The UI separates communication, approvals, agent status, and
    channel configuration.

- [x] **OCX-002 Add triage lanes.** Split the operator inbox into meaningful
  lanes.
  - Initial lanes: needs decision, waiting on agent, informational, failed/needs
    repair, muted, expired, completed.
  - Acceptance: Agent requests cannot flood the same lane as ordinary human
    messages.

- [x] **OCX-003 Add relationship-aware grouping.** Present people and systems by
  relationship/trust rather than only alphabetical contact list.
  - Groups: operator, family, trusted humans, external contacts, agents, systems,
    unknown, blocked.
  - Acceptance: Unknown and blocked entities have visibly different treatment.

### Phase 0.5: Shared shell alignment before Phase 1

- [x] **OCX-021 Align cockpit UI with the Tauri 2 shared shell.** Keep the
  renderer on a ForgeLink-owned bridge boundary and avoid new direct Electron
  assumptions before adding operator modes, presence, and mobile flows.
  - Acceptance: Cockpit UX changes can run through the future Tauri 2 desktop
    and mobile shells owned by work item 030.
  - Acceptance: Electron remains a temporary compatibility shell until item 030
    satisfies the retirement gate.

### Phase 1: Operator modes and presence

- [x] **OCX-004 Add operator availability modes.** Add explicit modes that inform
  attention policy.
  - Suggested modes: available, focus, driving, sleeping, family, work,
    emergency-only, offline.
  - Acceptance: Mode affects routing, redaction, batching, and escalation.

- [x] **OCX-005 Add local presence signals.** Use privacy-preserving local signals
  to improve attention routing.
  - Signals may include app focus, keyboard/mouse activity, system idle, battery,
    network, do-not-disturb, paired mobile proximity, and calendar integration if
    later approved.
  - Acceptance: Presence signals are local and visible/configurable.
  - Acceptance: No hidden surveillance behavior.

- [x] **OCX-006 Add emergency/crisis rules.** Add hard boundaries for urgent and
  emergency behavior.
  - Include emergency contact bypass, repeated urgent escalation, agent emergency
    impersonation prevention, safety-sensitive language handling, and local-only
    fail-safe behavior.
  - Acceptance: Agents cannot mark requests as emergency without matching policy.

### Phase 2: Tauri 2 mobile decision terminal experience

- [x] **OCX-007 Define Tauri-first mobile decision terminal MVP UX.** Keep the
  first mobile surface focused on human decisions rather than full chat, using
  the shared cockpit UI direction from work item 030.
  - Include: paired device, redacted alerts, approval cards, approve/deny, short
    reply, presence signal, emergency contact toggle, and device revoke.
  - Acceptance: Desktop remains source of truth.
  - Acceptance: Locked/mobile notification surfaces use redaction profiles.

- [x] **OCX-008 Add Tauri mobile decision terminal flow.** Design the flow where
  a local agent request appears on mobile, receives a signed decision through
  the shared UI/bridge model, and returns to desktop.
  - Acceptance: Flow supports approve, deny, defer, request more info, and short
    reply.
  - Acceptance: Mobile never needs full private database replication for the MVP.

### Phase 3: Reducing interruption cost

- [x] **OCX-009 Add batch approvals.** Batch related low/medium-risk requests into
  one decision surface.
  - Acceptance: User can approve all, approve selected, deny all, or inspect
    individual items.
  - Acceptance: Batch approval preserves individual audit/outcome records.

- [x] **OCX-010 Add human fatigue budget.** Track and use interruption pressure.
  - Metrics: interruptions today, urgent interruptions today, denied requests,
    expired requests, average response time, repeated interruptions by agent.
  - Acceptance: Policy can recommend batching, deferring, or muting when fatigue
    thresholds are exceeded.

- [x] **OCX-011 Add agent reputation UI.** Surface whether agents are earning or
  losing trust.
  - Signals: approvals, denials, expired requests, malformed requests, failed
    outcomes, modified-scope attempts, repeated urgent requests.
  - Acceptance: Reputation informs UI and suggestions but does not silently grant
    authority.

### Phase 4: Summaries and scoped context

- [x] **OCX-012 Add local semantic thread summaries.** Summarize long threads
  locally where feasible.
  - Include: what happened, open decisions, pending replies, last human action,
    and agent-relevant constraints.
  - Acceptance: Summaries are derived artifacts, not source of truth.
  - Acceptance: Cloud summarization is opt-in only if ever added.

- [x] **OCX-013 Add scoped MCP resources.** Expose safe, minimal resources to MCP
  clients instead of raw communication dumps.
  - Examples: `get_pending_approvals`, `get_contact_summary`,
    `get_thread_summary`, `get_agent_status`.
  - Acceptance: No `dump_all_messages` style resource is available by default.
  - Acceptance: Resource access respects contact policy, redaction, and agent
    trust.

### Phase 5: External communication UX

- [x] **OCX-014 Add reviewed outbox.** Provide a visible outbox for agent-drafted
  external messages.
  - Acceptance: Drafts can be reviewed, edited, approved, denied, scheduled, or
    sent.
  - Acceptance: The UI clearly distinguishes drafts from sent messages.

- [x] **OCX-015 Add channel redaction previews.** Show what will be visible on
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

- [x] **OCX-018 Add first-run sample workspace.** Provide an optional synthetic
  sample mode so new users can understand the product without real credentials.
  - Acceptance: Sample mode includes fake contacts, fake agents, fake approvals,
    fake outcomes, and fake channel states.
  - Acceptance: Sample data cannot be confused with real data.

### Phase 7: Summary safety and distribution (added 2026-06-18 gap review)

- [x] **OCX-019 Make local summaries injection-resistant.** Treat thread/agent content as untrusted, use injection-resistant prompting, show provenance, keep summaries advisory, and never let summarized content elevate authority or trigger actions.
- [x] **OCX-020 Define distribution and update strategy.** Code-signed desktop releases + auto-update channel, and a signed build/update path for the Tauri 2 mobile decision terminal, as a prerequisite for shipping the mobile surface (OCX-007/008) and the public demo; coordinate with 011 PR-014 and 030 TAURI-006.

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
- Mobile starts as a Tauri 2 decision terminal, not a private-data mirror.
- The cockpit UI should stay portable across Electron and Tauri through a narrow
  ForgeLink bridge boundary.
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
- Tauri 2 mobile decision terminal MVP UX;
- shared shell/app bridge constraints owned with work item 030;
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
| 2026-06-18 | planning | Deep product review identified operator cockpit features needed to make ForgeLink stand out as a state-of-the-art human-boundary app | Created item 017 before implementation starts. |
| 2026-06-18 | gap review | Roadmap gap review with operator: local-only onboarding, public-tunnel hardening, untrusted agent content, key management, agent-facing contract, conformance/integration testing, migration coordination, and distribution/updates | Added acceptance criteria and fixed README acceptance-criteria numbering to match work-item.json. |
| 2026-06-27 | OCX-001 complete | Desktop IA now starts with Decisions, People, Agents, and Channels: approval requests live in Decisions, People owns the human directory, Agents shows agent/channel health, and Channels keeps Messages, Calls, Signals, and provider readiness reachable without making ordinary conversations the primary surface. `docs/operator-cockpit.md`; renderer build + 25 renderer interaction tests passed. | OCX-001 satisfied (evidence 20260627-ocx001-decision-first-navigation). Next: OCX-002 triage lanes. |
| 2026-06-27 | OCX-002/003 complete | Decisions now renders seven triage lanes (needs decision, waiting on agent, informational, failed/repair, muted, expired, completed) using existing agent-message status/kind/action/error/expiry/muted-policy fields; People now groups contacts into operator, family, trusted humans, external contacts, agents, systems, unknown, and blocked, with unknown/blocked sections visually distinct. `docs/operator-cockpit.md`; renderer build + 27 renderer interaction tests passed. | OCX-002 and OCX-003 satisfied (evidence 20260627-ocx002-003-triage-relationship-grouping). Next: OCX-004 operator availability modes. |
| 2026-06-27 | Tauri shared-shell alignment | Operator decision: Phase 2 should target Tauri 2 so ForgeLink can share one cockpit UI across desktop and mobile, retire Electron after parity, and avoid a throwaway mobile companion. Created work item 030 and added OCX-021 as the pre-Phase-1 bridge/alignment gate. | 017 now coordinates mobile UX and distribution criteria with 030; no implementation criterion closed. |
| 2026-06-27 | OCX-021 complete | Added a ForgeLink-owned renderer shell bridge (`Electron/renderer/src/shell.ts`), moved cockpit native calls in `App.tsx` behind that bridge, exposed `forgeLinkShell` from Electron preload while retaining `desktop` as a compatibility alias, and documented the shared shell boundary in `docs/operator-cockpit.md`; renderer build + 28 renderer interaction tests passed. | OCX-021 satisfied (evidence 20260627-ocx021-shared-shell-bridge). Next: OCX-004 operator availability modes. |
| 2026-06-27 | OCX-004/005/006 complete | Settings now saves operator mode in attention policy and shows visible local presence signals (app focus, input activity, network, manual DND, paired mobile proximity); attention evaluation uses mode/presence to route, redact, batch, and escalate notifications; backend agent-channel intake rejects ungoverned emergency claims unless the request declares emergency authority or emergency/critical risk. `docs/operator-cockpit.md`; backend build, renderer build, attention tests, compiled server tests, and 28 renderer interaction tests passed. | OCX-004, OCX-005, and OCX-006 satisfied (evidence 20260627-ocx004-006-operator-modes-presence-emergency). Next: OCX-007 Tauri-first mobile decision terminal MVP UX. |
| 2026-06-28 | OCX-007/008 complete | Channels now exposes a shared Mobile terminal surface for the Tauri 2 decision-terminal MVP: paired status, redacted `mobile_lock_screen` alert/card, approve/deny/defer/request-more-info/short-reply actions, presence and emergency-contact state, device revoke, signed-return flow, and no private database replication. `docs/operator-cockpit.md`; renderer build, renderer interaction tests, and RepoPact/local validation passed. | OCX-007 and OCX-008 satisfied (evidence 20260628-ocx007-008-mobile-decision-terminal). Next: OCX-009 batch approvals. |
| 2026-06-28 | OCX-009/010/011 complete | Decisions now includes a low/medium-risk batch approvals panel with select all, approve all, approve selected, deny all, and visible individual inspection; Decisions also shows a local fatigue budget for interruptions today, urgent interruptions, denials, expirations, average response time, and repeated sources; Agents now shows advisory per-source reputation using approval, denial, expired, malformed, scope-flag, and urgent-request signals without granting authority. `docs/operator-cockpit.md`; renderer build, renderer interaction tests, full Electron test suite, and RepoPact/local validation passed. | OCX-009, OCX-010, and OCX-011 satisfied (evidence 20260628-ocx009-011-interruption-cost). Next: OCX-012 local semantic thread summaries. |
| 2026-06-29 | OCX-014/015/018 complete | New cockpit reviewed outbox (Channels → Reviewed outbox) lists agent-drafted external messages in pending/scheduled/sent/denied/failed lanes with review, edit, approve-and-send, deny, and schedule actions backed by the AGH-020 draft-don't-send engine; scheduled sends add schema v24 (`agent_outbound_drafts.scheduled_at`) and dispatch on outbox refresh. Each draft can preview its redacted payload across desktop/mobile/email/SMS/Discord profiles before dispatch (OCX-015). A first-run sample workspace (Settings) seeds clearly-synthetic contacts, agents, approvals, an outcome, and a channel state (reserved +1 202 555-0100 numbers, `sample-` ids), shows a persistent banner, and clears cleanly without touching real data or the audit chain. `docs/operator-cockpit.md`; backend build, summarizer/server/database tests (incl. scheduling, sample load/clear, v24 migration column), 33 renderer interaction tests, full Electron suite, and RepoPact/local validation passed. | OCX-014, OCX-015, and OCX-018 satisfied (evidence 20260629-ocx014-015-018-outbox-sample). |
| 2026-06-29 | mobile direction reframed | Operator correction: mobile ForgeLink is a full cockpit (same product as desktop, mobile layout), not a companion/decision-terminal-only app. Recorded [decision 0017](../../../decisions/0017-mobile-is-a-full-cockpit.md) and reframed work item 030 (TAURI-001/004, goal, non-goals, plus a planned `operator-status` device/Fabric bridge contract); `docs/operator-cockpit.md` and `docs/distribution-and-update-strategy.md` updated. The shipped OCX-007/008 mobile decision terminal is reinterpreted as the restricted mode/profile and its satisfied criteria are left unchanged. | No 017 criterion changed; direction reframing lives in decision 0017 and work item 030. |
| 2026-06-29 | OCX-020 complete | Defined the distribution and update strategy in `docs/distribution-and-update-strategy.md`: code-signed desktop releases with an electron-updater auto-update channel (operator opt-out, packaged-only) and a signed Tauri 2 mobile build/update path (store-distributed, pairing-not-replication), with the gates required before shipping the mobile surface (OCX-007/008) and the public demo (OCX-016). Coordinates with item 011 PR-014 (desktop signing/feed) and item 030 TAURI-006 (Tauri distribution + Electron retirement). Strategy/definition deliverable; no shipped behavior claimed beyond what PR-014 has landed. RepoPact/local validation passed. | OCX-020 satisfied (evidence 20260629-ocx020-distribution-strategy). Phase 5 and Phase 7 distribution complete; remaining: OCX-016 killer demo and OCX-017 public screenshots. |
| 2026-06-29 | OCX-012/019/013 complete | New backend `summary.ts` derives local, advisory thread summaries (what happened, open decisions, pending replies, last operator action, agent-relevant constraints) with a deterministic extractive pass — no model call, cloud summarization opt-in only and not enabled. Summaries treat thread content as untrusted: excerpts are sanitized and labeled, summaries carry provenance and an advisory notice, always report `authority: "none"`, and never grant authority or trigger actions (a documented injection-resistant prompt scaffold gates any future cloud path). New scoped resources `GET /api/threads/:id/summary`, `/api/contacts/summary`, `/api/agent-status`, `/api/pending-approvals` and MCP tools `get_thread_summary`/`get_contact_summary`/`get_agent_status`/`get_pending_approvals` expose redacted, derived views only; the scoped thread summary drops excerpts, contact summaries omit bodies and phone numbers, and no dump-all-messages resource exists. `docs/operator-cockpit.md`; backend build, 6 summarizer unit tests, compiled server tests (incl. scoped/MCP-safe access), MCP server tests, full Electron test suite, and RepoPact/local validation passed. | OCX-012, OCX-019, and OCX-013 satisfied (evidence 20260629-ocx012-019-013-thread-summaries). Phase 4 complete; next: OCX-014 reviewed outbox. |
