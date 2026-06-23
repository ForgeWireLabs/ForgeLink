---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-22
source_of_truth: work/completed/015-communication-channels-and-voice/README.md; work/completed/015-communication-channels-and-voice/work-item.json
---

# Work Item 015: Communication Channels and Voice

> Lifecycle state for this item lives in [`work-item.json`](work-item.json); this
> README is the intent, scope, sequencing, and closeout narrative. This item
> captures the next ForgeLink product arc discussed after reviewing ForgeLink's
> current SMS/MMS implementation and the earlier SCOUT-2 VoIP/Twilio prototype.

## Goal

Evolve ForgeLink from a Twilio-backed SMS/MMS desktop app into a local-first
communications runtime and provider-neutral human boundary with rich contact
metadata, native message/call/approval state, restored voice capability, call
UI/UX, channel-aware policy, and pluggable edge adapters.

ForgeLink should own the backend that gives communications meaning:

- contacts and contact identity;
- channel registry and routing;
- local inbox/outbox;
- local call ledger;
- approval lifecycle;
- attention policy;
- contact policy;
- retries and reconciliation;
- imports, exports, backups, retention, and diagnostics;
- local UI;
- local API;
- mobile companion pairing and signed human responses.

External services may carry packets. They must not define ForgeLink's product
model.

ForgeLink must preserve its current stronger architecture:

- local-first desktop ownership of human communication state;
- authenticated loopback API as the internal boundary;
- MCP bridge for agent-to-human communication;
- durable local message state;
- encrypted provider credentials;
- backup, export, retention, and recovery behavior;
- explicit attention policy.

The new work must not regress into the older SCOUT-2 model where Twilio was the
center of the implementation. Twilio remains one provider adapter. ForgeLink's
center is governed human communication state.

SMS and PSTN voice require a telecom edge when ForgeLink needs to reach ordinary
carrier phone numbers. ForgeLink can build its own messaging and voice control
backend, but it must still use a carrier-facing path, SIP trunk, provider, or
formal telecom interconnect for phone-number SMS/MMS and PSTN calling. This item
therefore distinguishes the ForgeLink-native core from telecom edge adapters.

## Background and lineage

SCOUT-2 included an early `modules/Tools/Comms/Voip` implementation with:

- contacts;
- phone/dialpad UI;
- conversation/message surfaces;
- profile picture support;
- Twilio SMS/MMS sending;
- Twilio Verify;
- Twilio Voice call start/end;
- contact project planning for import/export, favorites, interaction history,
  validation, backup/restore, and profile-picture UX.

ForgeLink has already surpassed that implementation in safety and architecture:

- Electron + React/TypeScript;
- bundled TypeScript backend;
- local SQLite persistence via Node's built-in SQLite support;
- encrypted credential lifecycle through Electron `safeStorage`;
- authenticated local API;
- webhook signature validation;
- delivery-state reconciliation;
- durable pending/failed/retry behavior;
- data safety tooling;
- MCP bridge and agent attention policy.

This item recovers the useful SCOUT-2 communication surface area while keeping
ForgeLink's newer boundary/channel model.

## Product framing

ForgeLink channels are adapters. The invariant is not SMS, Twilio, or voice.
The invariant is governed human attention and durable communication state.

WhatsApp, Discord, email, RSS, Telegram, push, SMS, MMS, voice, and future
channels are adapters to the same core. The core must be useful even when no
telecom provider is configured.

Target architecture:

```text
Agents / MCP clients / ForgeWire-Fabric / local systems
        |
        v
ForgeLink authenticated local API
        |
        +-- agent messages
        +-- approval requests
        +-- human actions
        +-- contact metadata
        +-- local inbox/outbox
        +-- local call ledger
        +-- attention policy
        +-- channel policy
        +-- signed local/mobile decisions
        |
        v
ForgeLink desktop app
        |
        +-- contacts
        +-- conversations
        +-- calls
        +-- approvals
        +-- settings
        +-- diagnostics
        |
        v
ForgeLink-native channels
        |
        +-- local desktop notifications
        +-- local network/mobile companion
        +-- local agent/system contacts
        |
        v
External edge adapters
        |
        +-- telecom sms/mms edge: Twilio
        +-- telecom sms/mms edge: Telnyx
        +-- telecom sms/mms edge: Plivo
        +-- telecom sms/mms edge: Bandwidth
        +-- telecom voice edge: Twilio first, provider-neutral contract
        +-- internet adapters: email, push, Telegram, WhatsApp, Discord, RSS
        +-- future telecom path: SIP trunk or direct carrier/interconnect research
```

Matrix is intentionally out of scope for this item. It may be reconsidered later
only if a concrete operator deployment requires it.

## Non-goals

- Do not paste or directly restore SCOUT-2 Python code.
- Do not reintroduce Python runtime requirements.
- Do not make Twilio the central abstraction.
- Do not add Matrix support in this item.
- Do not expose a public remote control API for arbitrary callers.
- Do not pretend ForgeLink can send carrier SMS/MMS or PSTN calls without a
  carrier-facing edge, SIP trunk, provider, or formal telecom interconnect.
- Do not make telecom provider support the primary ForgeLink human loop.
- Do not weaken local API authentication or webhook signature handling.
- Do not persist provider secrets in plaintext.
- Do not log credentials, message bodies, contact data, call audio, or media by
  default.
- Do not make live provider tests mandatory in CI.
- Do not claim end-to-end encrypted communications unless the implemented channel
  truly provides that property.

## Priority order

### Phase 0: Local communications runtime and channel architecture

- [x] **CLV-001 Define the local communications runtime.** Formalize the
  ForgeLink-owned backend for local inbox/outbox, message state, call state,
  approval state, channel registry, contact identity, contact policy, attention
  policy, retries, reconciliation, and diagnostics.
  - Acceptance: There is a documented internal model separating ForgeLink-owned
    communication state from external transport/provider state.
  - Acceptance: The core can represent local-only agent-to-human messages and
    approval requests when no telecom provider is configured.
  - Acceptance: Existing SMS/MMS messages continue to map into the same local
    communication model.

- [x] **CLV-002 Define the channel and edge-adapter model.** Introduce
  provider-neutral contracts for native channels, external internet adapters, and
  telecom edge adapters, including capabilities, provider identity,
  send/receive results, webhook parsing, delivery status, errors, media support,
  and credential requirements.
  - Acceptance: Type definitions or equivalent runtime contracts exist for
    channel capability discovery, local message delivery, SMS/MMS send, voice
    call control, inbound webhook normalization, status update normalization,
    media normalization, provider errors, and credential validation.
  - Acceptance: Existing Twilio SMS/MMS behavior runs through the new adapter
    boundary without changing current user-visible messaging behavior.
  - Acceptance: Tests prove the app can select a configured provider and reject
    unsupported capabilities cleanly.

- [x] **CLV-003 Preserve Twilio as the first SMS/MMS telecom edge adapter.** Move current
  Twilio-specific SMS/MMS logic behind the provider contract while preserving
  existing onboarding, webhook, status, media, retry, and delivery behavior.
  - Acceptance: Existing Twilio tests are updated to prove contract compliance.
  - Acceptance: Twilio-specific fields remain stored only where needed for
    provider reconciliation.
  - Acceptance: The UI describes the configured SMS/MMS provider without
    presenting ForgeLink itself as Twilio-specific.

### Phase 1: ForgeLink-native human loop

- [x] **CLV-004 Add local-only agent-to-human channel support.** Ensure the MCP
  bridge and local API can deliver agent messages and approval requests through
  ForgeLink's native desktop UI without requiring SMS/MMS, voice, or any third
  party provider.
  - Acceptance: Agent messages, approval requests, dismissals, and action records
    can be created, displayed, updated, and resolved using only the local app.
  - Acceptance: Native local notifications can open the correct ForgeLink view.
  - Acceptance: Local-only operation is represented clearly in Settings and
    diagnostics.

- [x] **CLV-005 Design ForgeLink mobile companion protocol.** Define a first-party
  mobile companion path as the native non-SaaS replacement for the primary human
  loop.
  - Include: QR-code or equivalent pairing, device identity, key exchange, local
    network transport, optional future relay boundary, redacted notifications,
    signed approve/deny responses, revocation, lost-device handling, and desktop
    as source of truth.
  - Acceptance: Protocol/design document exists under `docs/` or `decisions/`.
  - Acceptance: The design distinguishes local LAN companion operation from any
    future relay/push service.
  - Acceptance: The design supports agent approvals without SMS or external chat
    providers.

- [x] **CLV-006 Add mobile companion planning gate.** Add implementation stubs,
  schemas, or route contracts for future desktop-to-mobile pairing without
  shipping an incomplete mobile product.
  - Acceptance: The current desktop app can represent the companion as planned or
    unavailable without broken UI paths.
  - Acceptance: Any added routes are authenticated and disabled unless explicitly
    enabled.
  - Acceptance: No public relay semantics are introduced in this work item.

### Phase 2: Telecom SMS/MMS edge expansion

- [x] **CLV-007 Add Telnyx SMS/MMS telecom edge support.** Implement Telnyx as the
  second SMS/MMS provider because it closely matches ForgeLink's needs:
  outbound SMS/MMS, inbound webhooks, delivery status updates, signature
  verification, provider errors, media handling, and messaging profiles.
  - Acceptance: Contract tests cover send success, send rejection, inbound SMS,
    inbound MMS metadata, duplicate inbound webhook, delivery status update,
    backward/duplicate status transition, invalid signature, and missing
    credentials.
  - Acceptance: Telnyx setup is available in Settings without breaking Twilio
    setup.
  - Acceptance: Telnyx provider documentation is added under `docs/`.

- [x] **CLV-008 Add Plivo and Bandwidth telecom edge planning gates.** Add provider stubs or
  decision records for Plivo and Bandwidth with explicit capability mapping,
  credential requirements, webhook validation requirements, MMS/media handling,
  and test fixture requirements.
  - Acceptance: Plivo and Bandwidth are not presented as shipped providers until
    tests and docs exist.
  - Acceptance: The provider registry can represent unimplemented/planned
    providers without exposing broken UI paths.

### Phase 3: Contact metadata and policy

- [x] **CLV-009 Add rich contact metadata.** Extend existing ForgeLink contacts
  with metadata needed for a private communications console.
  - Include, at minimum: display name, avatar/media reference, notes, company,
    role/title, tags, favorite/pinned state, trust level, relationship/category,
    created/updated timestamps, and optional address fields if already aligned
    with the current contact model.
  - Acceptance: Schema migration is transactional and backed up before mutation.
  - Acceptance: Existing contacts migrate without data loss.
  - Acceptance: Renderer tests cover create/edit/delete metadata behavior and
    existing SMS composition still works.

- [x] **CLV-010 Add contact points and channel identities.** Model multiple
  phone numbers, emails, and future channel identities per contact.
  - Acceptance: A contact can have multiple labeled phone numbers with one
    primary number.
  - Acceptance: Unknown inbound numbers can be attached to an existing contact,
    turned into a new contact, ignored, or blocked.
  - Acceptance: Message threads and call logs resolve contact identity through
    contact points rather than a single flat number field.

- [x] **CLV-011 Add contact-level policy.** Add policy metadata that controls
  how contacts interact with agent messages, approval requests, urgent
  interrupts, quiet hours, and blocked/muted behavior.
  - Acceptance: Contact policy can represent unknown, known, trusted, operator,
    and blocked contacts.
  - Acceptance: Unknown inbound contacts do not automatically gain approval or
    urgent-interrupt privileges.
  - Acceptance: Blocked/muted contacts are enforced consistently in notifications
    and future voice behavior.

### Phase 4: Voice architecture and telecom edge support

- [x] **CLV-012 Define the voice runtime and edge-provider contract.** Add
  provider-neutral voice contracts for local call state, outbound calls, inbound
  call events, call status, call end, caller/callee identity, call log
  persistence, provider errors, and telecom edge boundaries.
  - Acceptance: Contract supports Twilio Voice without hard-coding Twilio into
    UI or data model names.
  - Acceptance: Voice capability can be disabled cleanly when credentials or
    provider support are absent.
  - Acceptance: Voice scope is documented as call control and call history first;
    call recording/transcription/audio streaming are separate explicit decisions.
  - Acceptance: Documentation states that PSTN calling requires a telecom edge
    such as a provider, SIP trunk, carrier partnership, or direct interconnect.

- [x] **CLV-013 Implement Twilio Voice as the first voice telecom edge adapter.** Restore the
  useful SCOUT-2 voice capability through the new TypeScript/Electron architecture,
  not by restoring Python code.
  - Acceptance: Outbound call start/end works through the provider contract.
  - Acceptance: Provider call SIDs map to durable local call rows.
  - Acceptance: Call status callbacks update the local call row idempotently.
  - Acceptance: Failed calls surface actionable but redacted provider errors.
  - Acceptance: Automated tests cover call start, call end, status callback,
    duplicate callback, invalid callback signature where applicable, missing
    credentials, and provider failure.

- [x] **CLV-014 Decide Twilio Verify scope.** Decide whether phone verification
  belongs in ForgeLink as a shipped capability, a future provider capability, or
  out of scope.
  - Acceptance: Decision is recorded in `decisions/` or this work item.
  - Acceptance: If implemented, verification is provider-neutral and does not
    grant trust level automatically without explicit operator policy.

### Phase 5: Voice UI/UX

- [x] **CLV-015 Add call UI surface.** Add a voice UI comparable in spirit to
  SCOUT-2's phone surface but rebuilt for ForgeLink.
  - Include: dialpad, selected contact, call button/end button, call status,
    disabled state when voice is unavailable, and provider/configuration hints.
  - Acceptance: Keyboard operation is supported.
  - Acceptance: UI does not imply live audio features that are not implemented.
  - Acceptance: Visual smoke and renderer interaction tests cover call UI states.

- [x] **CLV-016 Add call history.** Persist and display contact-linked call
  history.
  - Include: direction, provider, from/to, contact resolution, status, start time,
    end time, duration when available, provider ID, and redacted error summary.
  - Acceptance: Call history survives restart.
  - Acceptance: Call history is included in data export where appropriate and
    covered by retention/backups.
  - Acceptance: Call history is excluded from support diagnostics by default.

- [x] **CLV-017 Add contact timeline.** Merge human-visible contact history
  across SMS/MMS messages, future voice calls, and agent-originated requests.
  - Acceptance: Contact detail view can show a timeline without mixing private
    agent approval details into ordinary SMS threads unless explicitly selected.
  - Acceptance: Timeline respects retention and blocked/muted policy.

### Phase 6: Future channel and direct-telecom research gates

- [x] **CLV-018 Add channel roadmap records for email, push, Telegram, WhatsApp,
  Discord, RSS, and related adapters.**
  - Email: durable/auditable fallback channel.
  - Push: urgent notification channel using ntfy/Pushover-style semantics or a
    future first-party push path.
  - Telegram: developer/demo-friendly bidirectional channel with quick actions.
  - WhatsApp Business: later official business-channel option with heavier setup.
  - Discord: team/community chat adapter, not a primary private operator boundary.
  - RSS: inbound signal/feed adapter, not a person-to-person messaging channel.
  - Acceptance: Roadmap records include intended use, privacy/security notes,
    likely credentials, inbound/outbound capability, quick-action support,
    failure modes, and why Matrix is excluded from this item.

- [x] **CLV-019 Add direct telecom research record.** Research and record what it
  would actually take to reduce reliance on Twilio/Telnyx/Plivo/Bandwidth for
  carrier SMS/MMS and PSTN voice.
  - Include: SIP trunking, SMPP, SMSC/MMSC access, phone number provisioning,
    A2P/10DLC, STIR/SHAKEN, caller ID reputation, CNAM, E911/emergency scope,
    toll-free/short-code options, carrier partnership, regulatory and operating
    costs, and why this is not the first implementation path.
  - Acceptance: Record clearly separates feasible local implementation from
    carrier/regulatory interconnect requirements.
  - Acceptance: Record identifies the lowest-friction future path if ForgeLink
    ever wants a more direct telecom edge.

### Phase 7: Local-only onboarding, provider conformance, and migration safety (added 2026-06-18 gap review)

- [x] **CLV-020 Make first-run provider-optional.** Install and onboard into a usable local-only state (agent approvals + local human loop) with no telecom provider; offer a 'Start local-only' path so Twilio credentials are never forced. Resolves the mismatch where the shipped first-run requires Twilio while CLV-004 promises provider-free operation.
- [x] **CLV-021 Add a shared provider conformance test kit.** One reusable suite every SMS/MMS and voice edge adapter must pass (send/reject, inbound, duplicate webhook, status transitions, invalid signature, missing credentials, media) so providers meet one bar.
- [x] **CLV-022 Coordinate concurrent schema migrations.** Sequential schema-version ownership across 015/016/017 with documented migration order, each tested from the previously shipped schema.

## Suggested data model direction

This is a planning target, not a required literal schema. Implementation agents
must reconcile it with the current database and migration conventions.

```text
contacts
  id
  display_name
  notes
  avatar_media_id
  company
  role
  relationship
  trust_level
  pinned
  favorite
  created_at
  updated_at

contact_points
  id
  contact_id
  kind: phone | email | telegram | whatsapp | local_agent | other
  value
  label
  is_primary
  verified_at
  blocked_at
  created_at
  updated_at

contact_policy
  contact_id
  allow_agent_messages
  allow_approval_requests
  allow_urgent_interrupts
  quiet_hours_override
  muted_until
  retention_policy_id
  created_at
  updated_at

contact_tags
  contact_id
  tag

channel_providers
  id
  kind: native | sms_mms_edge | voice_edge | email | push | chat | feed
  provider: local | mobile_companion | twilio | telnyx | plivo | bandwidth | other
  display_name
  enabled
  capabilities_json
  created_at
  updated_at

messages
  existing fields...
  provider_kind
  provider_name
  provider_message_id
  contact_id
  contact_point_id

calls
  id
  local_call_id
  provider_kind
  provider_name
  provider_call_id
  direction
  from_contact_point_id
  to_contact_point_id
  contact_id
  status
  started_at
  answered_at
  ended_at
  duration_seconds
  redacted_error
  created_at
  updated_at

paired_devices
  id
  display_name
  device_public_key
  pairing_state
  last_seen_at
  revoked_at
  created_at
  updated_at
```

## Security and privacy constraints

- Provider credentials must use the existing secure settings pattern or a
  stronger replacement.
- Renderer-visible provider status must stay redacted.
- Webhooks must use provider-appropriate signature validation.
- Local private routes must remain authenticated.
- Contact metadata, messages, call history, media, and provider IDs are sensitive
  local data.
- Support diagnostics must exclude personal communication data by default.
- Test fixtures must not contain real phone numbers, credentials, message bodies,
  personal contacts, call SIDs, provider account IDs, or media URLs.
- Any screenshots used as public evidence must be synthetic/redacted.

## Documentation requirements

Add or update docs for:

- ForgeLink-owned local communications runtime;
- channel/provider architecture;
- native local-only agent-to-human operation;
- mobile companion pairing protocol and non-goals;
- configuring Twilio SMS/MMS after provider abstraction;
- configuring Telnyx if implemented;
- telecom edge boundaries for carrier SMS/MMS and PSTN voice;
- voice scope and limitations;
- contact metadata and contact policy;
- data safety implications for call history and contact exports;
- migration notes from earlier Twilio-only releases;
- operator guidance for provider credentials and webhook URLs.

## Cross-cutting definition of done

- All new durable work is represented in `work-item.json` acceptance criteria.
- Schema migrations are tested from the previous shipped schema.
- Existing Twilio SMS/MMS behavior remains green.
- Existing data safety, backup, export, and retention tests remain green.
- Renderer interaction tests cover new UI state.
- Security-sensitive claims have tests or reproducible evidence.
- Live-provider tests are opt-in and clearly separated from deterministic CI.
- Docs describe shipped behavior only; future ideas stay in this work item until
  implemented.
- Every closed criterion records commands run, evidence, limitations, and rollback
  notes.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-18 | planning | Reviewed ForgeLink work ledger conventions and SCOUT-2 Twilio/VoIP lineage | Created item 015 before implementation starts. |
| 2026-06-18 | planning update | Clarified that ForgeLink should own the native communications runtime while SMS/MMS and PSTN voice use telecom edge adapters when ordinary phone network reachability is required | Promoted local-only human loop and mobile companion design into explicit acceptance criteria. |
| 2026-06-18 | gap review | Roadmap gap review with operator: local-only onboarding, public-tunnel hardening, untrusted agent content, key management, agent-facing contract, conformance/integration testing, migration coordination, and distribution/updates | Added acceptance criteria and fixed README acceptance-criteria numbering to match work-item.json. |
| 2026-06-18 | Phase 0 begin | Added provider-neutral channel/adapter contracts (`backend/src/channels.ts`) + capability registry with selection and clean rejection of unsupported capabilities; unit-tested | First 015 slice landed (evidence `20260618-clv-channel-contracts`). CLV-001 model doc, CLV-002 Twilio-through-boundary, and CLV-003 are next; criteria remain pending. |
| 2026-06-18 | Phase 0 complete | CLV-001 runtime-model doc; CLV-002 contracts+registry with Twilio running through the adapter boundary; CLV-003 Twilio edge adapter + contract test, behaviour preserved (16 server/channel/twilio tests green) | Phase 0 done (evidence 20260618-clv-phase0). |
| 2026-06-18 | Phase 1 complete | CLV-004 native local channel + local-only diagnostics/Settings; CLV-005 mobile companion protocol design (decision 0006); CLV-006 gated, authenticated, disabled-by-default companion route (no relay) | Phase 1 done (evidence 20260618-clv-phase1). |
| 2026-06-18 | Phase 2 complete | CLV-007 Telnyx SMS/MMS edge (send + JSON webhook normalization + Ed25519 /webhooks/telnyx + contract tests + docs); CLV-008 Plivo/Bandwidth planning gates (decision 0007, planned_channels) | Phases 0-2 done (evidence 20260618-clv-phase2). |
| 2026-06-18 | Phase 3 begin (data) | Schema v8 migration: contact metadata columns + contact_points + contact_policy (backfilled, transactional, backed up); backend methods + tests | Data foundation for CLV-009/010/011 (evidence 20260618-clv-phase3-data). API + renderer UI + attention enforcement remain; criteria still pending. |
| 2026-06-18 | Phase 3 data foundation | Schema v8 (contact metadata + contact_points + contact_policy, transactional + backed up, existing contacts backfilled); backend methods + tests | CLV-009/010/011 data layer landed (evidence 20260618-clv-phase3-data); API + renderer UI + attention enforcement remaining. |
| 2026-06-20 | CLV-009 complete | Six token-gated contact endpoints (update/delete/points/policy); renderer Edit modal (company/role/tags/notes/trust-level/pinned/favorite) + confirm-guarded delete; v8 migration hardened to skip pre-existing legacy columns | CLV-009 satisfied (evidence 20260620-clv009-contacts-ui). CLV-010 unknown-inbound handling + CLV-011 attention enforcement remain. |
| 2026-06-20 | CLV-010 complete | Contact-point editor + API client methods; unknown inbound threads remain unlinked until acted on; attach-to-existing adds a contact point; create-from-thread, ignore, and block routes added; message threads resolve through contact_points | CLV-010 satisfied (evidence 20260620-clv010-contact-points). CLV-011 attention enforcement remains next. |
| 2026-06-20 | CLV-011 complete | Contact policy editor + API client methods; inbound SMS from muted/blocked contact points persists without unread attention; contact-resolved agent messages enforce allow-agent, approval-request, urgent-interrupt, muted, and blocked policy gates | CLV-011 satisfied (evidence 20260620-clv011-contact-policy). Phase 3 contact metadata/policy complete; voice runtime criteria are next. |
| 2026-06-20 | CLV-012 complete | Provider-neutral voice runtime contract added with local call/request/result/status/persistence shapes, adapter hooks for voice availability/start/end/inbound/status, deterministic contract tests, and `docs/voice-runtime.md` boundary documentation | CLV-012 satisfied (evidence 20260620-clv012-voice-contracts). Twilio Voice implementation remains CLV-013. |
| 2026-06-20 | CLV-013 complete | Twilio Voice edge adapter added with outbound start/end, schema v10 durable call rows, signed voice status callbacks, inbound call-row creation, idempotent status transitions, redacted provider errors, and deterministic database/adapter/server tests | CLV-013 satisfied (evidence 20260620-clv013-twilio-voice-edge). Twilio Verify scope decision remains CLV-014. |
| 2026-06-20 | CLV-014 complete | Decision `0008` records Twilio Verify as deferred future provider-neutral capability; `docs/twilio.md` documents that Verify is not shipped and cannot grant trust, approvals, urgent interrupts, or unblock behavior without explicit operator policy | CLV-014 satisfied (evidence 20260620-clv014-twilio-verify-scope). Voice UI surface remains CLV-015. |
| 2026-06-20 | CLV-015 complete | Added Calls rail view with dialpad, contact selector, call/end controls, active status, disabled provider hints, keyboard shortcuts, recent calls, renderer interaction tests, and Calls visual smoke screenshot | CLV-015 satisfied (evidence 20260620-clv015-call-ui). Durable call-history UX remains CLV-016. |
| 2026-06-20 | CLV-016 complete | Enriched durable call history rows with contact names/contact-point labels for the Calls UI; retained direction/provider/from-to/status/timestamps/duration/provider ID/redacted errors; added retention deletion for old calls while keeping backup/export coverage; asserted diagnostics exclude call IDs and phone numbers by default | CLV-016 satisfied (evidence 20260620-clv016-call-history). Contact timeline remains CLV-017. |
| 2026-06-20 | CLV-017 complete | Added authenticated contact timeline API and contact-detail timeline panel merging SMS/MMS messages, voice call rows, and agent-originated requests; private agent details are redacted by default and revealed only through an explicit operator toggle; renderer/backend tests and visual smoke cover the redacted timeline path | CLV-017 satisfied (evidence 20260620-clv017-contact-timeline). Channel roadmap records remain CLV-018. |
| 2026-06-20 | CLV-018 complete | Decision `0009` records future channel roadmap boundaries for email, push, Telegram, WhatsApp Business, Discord, RSS/Atom, first-party mobile companion, local webhooks/LAN integrations, and direct telecom separation; detailed active work items `018`-`024` now split those roadmap paths into acceptance criteria; includes privacy/security notes, likely credentials, inbound/outbound capability, quick-action boundary, failure modes, and Matrix exclusion rationale | CLV-018 satisfied (evidence 20260620-clv018-channel-roadmap). Direct telecom research remains CLV-019. |
| 2026-06-20 | CLV-019 complete | Decision `0010` records direct telecom research for SIP trunking, SMPP, SMSC/MMSC access, phone-number provisioning, A2P/10DLC, STIR/SHAKEN, caller ID reputation, CNAM, E911, toll-free/short-code messaging, carrier partnership, operating costs, and the staged path if ForgeLink later needs a more direct edge | CLV-019 satisfied (evidence 20260620-clv019-direct-telecom-research). Provider-optional onboarding remains CLV-020. |
| 2026-06-20 | CLV-020 complete | Added provider-optional first-run: settings now track `onboarding_complete` separately from telecom credentials; first-run offers `Start local-only`; local-only startup persists loopback-only settings with no Twilio secrets; removing credentials keeps the app onboarded; Settings can restart unconfigured local service without Twilio validation | CLV-020 satisfied (evidence 20260620-clv020-provider-optional-onboarding). Provider conformance test kit remains CLV-021. |
| 2026-06-22 | CLV-021 complete | Shared provider conformance kit (`backend/src/channel-conformance.ts`) with `runSmsEdgeConformance`/`runVoiceEdgeConformance`; Twilio (SMS + voice) and Telnyx (SMS) now run through the same suite covering capability advertisement, send success/rejection, inbound + MMS/media normalization, status normalization, duplicate-inbound idempotency and backward/duplicate status transition (driven through a temp `PhoneDatabase`), signature valid/invalid, and missing credentials; `docs/provider-conformance.md` documents the bar for new providers; 21 new cases green (`node --test` twilio+telnyx, 58 pass) | CLV-021 satisfied (evidence 20260622-clv021-provider-conformance-kit). Schema-migration coordination remains CLV-022. |
| 2026-06-22 | CLV-022 complete | Decision `0011` establishes the schema-migration coordination convention: one append-only contiguous migration ladder in `database.ts`, sequential `user_version` ownership tracked per version in an allocation table (v1-v7 foundations; v8-v10 015; future items claim the next free integer and record ownership), documented migration order, a claim procedure, and the rule that every step is tested from a previously shipped schema; added a v7 pre-015 upgrade test alongside the existing v1 legacy upgrade test (both reach `CURRENT_SCHEMA_VERSION` with a pre-migration backup and no data loss); 77 backend tests green | CLV-022 satisfied (evidence 20260622-clv022-schema-migration-coordination). Phase 7 complete; all 015 acceptance criteria satisfied. |
| 2026-06-22 | closeout | All 22 acceptance criteria (CLV-001..CLV-022) satisfied; item moved to `work/completed/`; status flipped in README frontmatter and `work-item.json` | 015 completed. |

## Closeout

All 22 acceptance criteria (CLV-001 through CLV-022) are satisfied. ForgeLink now
has a provider-neutral, local-first communications runtime with the channel/edge
architecture this item set out to build.

### What shipped

- **Channel architecture** — provider-neutral contracts and a capability registry
  (`backend/src/channels.ts`); native, internet, and telecom-edge channel kinds;
  clean rejection of unsupported capabilities.
- **Telecom edges** — Twilio (SMS/MMS + Voice) and Telnyx (SMS/MMS) behind the
  contract; Plivo/Bandwidth recorded as planning gates (decision 0007).
- **Native human loop** — local-only agent-to-human messages, approvals, and
  notifications with no provider required; mobile companion protocol designed and
  gated (decision 0006), disabled-by-default authenticated route, no public relay.
- **Contacts** — rich metadata, contact points / channel identities, and
  contact-level attention policy (schema v8/v9) with renderer UI and enforcement.
- **Voice** — provider-neutral voice runtime (`docs/voice-runtime.md`), Twilio
  Voice edge with durable call rows (schema v10), call UI, durable call history,
  and a merged, redaction-aware contact timeline.
- **Onboarding** — provider-optional first-run (`Start local-only`).
- **Quality bar** — shared provider conformance kit
  (`backend/src/channel-conformance.ts`, `docs/provider-conformance.md`) and a
  schema-migration coordination convention (decision 0011).

### Decisions produced

0006 (mobile companion), 0007 (Plivo/Bandwidth planning), 0008 (Twilio Verify
scope), 0009 (channel roadmap / Matrix exclusion), 0010 (direct telecom research),
0011 (schema-migration coordination).

### Successor work

This item is the architectural anchor for the channel-adapter items it spun out —
**018** (email), **019** (push), **020** (Telegram), **021** (WhatsApp Business),
**022** (Discord), **023** (RSS/Atom follow-up), **024** (local webhooks / LAN) —
all of which `depend_on` 015. Governance (016) and the operator cockpit (017)
build on this runtime. New telecom/channel adapters must pass the conformance kit
and claim the next free schema version in the allocation table in decision 0011.

### Limitations / remaining risk

- Live-provider tests remain opt-in; CI coverage is deterministic stubs only.
- PSTN SMS/MMS and voice still require a telecom edge; no direct carrier
  interconnect (deliberate, per decision 0010).
- The mobile companion is designed and gated, not shipped.
- Schema-version ownership is a documented convention (decision 0011 allocation
  table), not yet validator-enforced (0011 notes a possible future
  `CURRENT_SCHEMA_VERSION`-monotonicity check).

### Rollback

No destructive migrations were introduced in the closing slices (CLV-021 is
test-only; CLV-022 added a test and documentation). Schema v8–v10 each back up the
database before mutating and are covered by from-previous-shipped-schema tests.
