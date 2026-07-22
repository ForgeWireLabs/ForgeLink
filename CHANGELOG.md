# Changelog

All notable changes to ForgeLink are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and ForgeLink uses semantic
versions tracked in `VERSION` and `Electron/package.json`.

## [Unreleased]

### Added
- First-class Telnyx SMS/MMS integration (work item 035): OS-encrypted in-app
  credentials, read-only number/profile validation, explicit Twilio/Telnyx
  selection used by send/retry/approved-draft paths, redacted provider status,
  and bounded automatic messaging-profile webhook setup. The shared Tauri bridge
  reports its still-gated desktop-service requirement instead of claiming
  unproved secure-storage parity. See `docs/telnyx.md`.
- Trusted-signal follow-up (work item 023): RSS/Atom stays a reading lane only.
  Hardening covers bounded XML validation, DNS pin-on-connect under a shared
  deadline, always-forbidden metadata/link-local ranges, IANA special-purpose
  redirect blocking (including mixed LAN/special answers), hop-aware HTTPS
  downgrade rejection, value-aware credential detection/redaction (scheme-relative
  and `user:pass@host` carriers; JWT objects with `alg`), and non-destructive
  migration-era external-id dedupe that preserves opaque feed GUIDs and replaces
  colliding credential external ids with non-secret surrogates. See
  `docs/trusted-signals.md`.

### Changed
- Repository integrity: ForgeLink now pins RepoPact 2.1.0 at immutable commit
  `126264a`; governance validation rejects a missing or stale generated dashboard,
  and RepoPact mutation/repair commands regenerate the canonical projection. The
  commit and push gates therefore cannot pass while dashboard work counts or active
  items disagree with the source ledger (work item 033).
- Responsive cockpit layout: metric and card grids now use fluid `auto-fit`
  columns, and the two-pane content layouts (calls, signals, mobile terminal)
  stack on narrow widths, so the UI reflows cleanly as the window resizes and
  toward the Tauri 2 mobile cockpit. Fixes the cramped Android/Fabric Device
  Health metric grid (work item 030 groundwork, decision 0017).

### Added
- Push notification channel — completes work item 019: a provider-neutral `push_send`
  channel that alerts an operator without carrying private communication state.
  Redaction profiles default to lock-screen-safe (only generic category text leaves
  the device); a `full` profile emits clamped, control-stripped content only when
  explicitly selected (PUSH-001/002/004). The push topic and token are stored
  OS-encrypted (Electron safeStorage) in the main process — never in the
  DB/renderer/logs/diagnostics/exports — with rotation by re-save and revoke by
  remove (PUSH-003). A Settings "Push notifications" card provides setup, a test
  notification, redacted status, revoke, and a redaction preview (PUSH-006). Push is
  notification-only: a tap is never approval authority, and any future action must use
  the signed action path (PUSH-005). ntfy is the documented initial provider
  (topic-based, self-hostable) behind an injectable transport; disabled by default
  (no topic ⇒ off). Default ntfy transport live verification is deferred. See
  `docs/push-channel.md`.
- Email channel (secure storage, inbound, quick-actions) — completes work item 018:
  SMTP and inbound/quick-action secrets are stored OS-encrypted (Electron
  safeStorage) in the main process and entered via a Settings form, never exposed to
  the renderer/logs/diagnostics/exports (EMAIL-002); inbound email arrives through a
  signed, disabled-by-default provider webhook with dedup, contact resolution, and
  bounded handling (EMAIL-004); and signed email quick-action links enforce
  signature, expiry, a real pending request, agent trust, and single-use anti-replay
  before recording an operator decision (EMAIL-006).
- Email channel (configuration + data safety): a Settings "Email channel" card
  showing redacted status (configured/host/from booleans + recorded count) and
  setup guidance, framing email as a fallback that grants no approval privileges;
  contact email identities via contact points (kind: email). Sent email is recorded
  as private communication data (schema v25 `email_messages`) that participates in
  backup, export, and retention; `/api/diagnostics` exposes only the
  `email_configured` boolean (work item 018, EMAIL-005/007).
- Email channel (outbound): a provider-neutral SMTP email adapter behind the
  channel registry, registered when `FORGELINK_SMTP_*` is configured. Outbound send
  with attachment bounds, MIME assembly, and redacted retryable/permanent failure
  classification; `/api/diagnostics` exposes only an `email_configured` boolean.
  Inbound ingest, configuration UI, and signed quick-actions are deferred. See
  `docs/email-channel.md` (work item 018, EMAIL-001/003/008).
- Release preflight: `npm run release:check` automates the non-signing release
  gates (VERSION/package.json sync, `[Unreleased]` notes, the electron-updater
  dependency, `builder.json` publish/asarUnpack/files config, referenced icon
  assets, and the auto-update guard), tested and wired into the release checklist
  (work item 011, PR-014).
- Reproducible killer demo: `npm run demo` runs a synthetic, credential-free
  walkthrough of the full decision lifecycle (agent release-approval with evidence
  pack → Decisions surface → redacted mobile alert → operator approval → agent
  outcome → audited replay), covered by a test and documented in
  `docs/killer-demo.md` (OCX-016).
- Public narrative and synthetic screenshots: the README leads with the
  Decisions/People/Agents/Channels cockpit (telecom providers as adapters), with
  `docs/public-narrative.md` for positioning, and the visual-smoke harness now
  captures the four cockpit surfaces from synthetic, redacted data via
  `npm run screenshot` (OCX-017).
- Android/Fabric device health: the mobile cockpit surface now has an advisory,
  read-only "Android / Fabric Device Health" panel that consumes the ROM lab
  `operator-status` bridge payload (typed, fixture-backed, with `ok:false`/malformed
  treated as degraded). It is display-only and never grants authority or triggers
  actions (work item 030 TAURI-008, decision 0017).
- Operator-status transport: a launch-only `GET /api/device/operator-status` runs
  the operator-configured ROM lab wrapper (`FORGELINK_OPERATOR_STATUS_SCRIPT`) with
  a validated `request_id` via an `execFile` arg array, timeout-bounded, returning
  the bridge JSON or a degraded `ok:false` body. The device-health panel uses it for
  live "Check device status"; disabled until the script path is configured. Not
  MCP-reachable and exposes no raw device/shell surface (work item 030 TAURI-009).
- Reviewed outbox: agent-drafted external messages appear in a cockpit outbox
  (Channels → Reviewed outbox) where the operator can review, edit, approve and
  send, deny, or schedule each draft, with pending drafts kept separate from sent
  messages. Scheduled sends are held with a send time and dispatched on outbox
  refresh (schema v24 adds the scheduled-send column) (OCX-014).
- Channel redaction previews: before dispatch, the outbox can preview what each
  channel (desktop, mobile lock screen, email, SMS fallback, Discord/status) will
  reveal, marking each as full or redacted (OCX-015).
- First-run sample workspace: an optional synthetic workspace (Settings → Sample
  workspace) seeds clearly-labeled fake contacts, agents, approvals, an outcome,
  and a channel state so a new operator can explore the cockpit without real
  credentials. A banner marks sample mode and clearing removes only synthetic
  records (OCX-018).
- Distribution and update strategy: documented the code-signed desktop release +
  auto-update model and the signed Tauri 2 mobile build/update path, with the
  gates required before shipping the mobile surface and public demo; coordinates
  with item 011 PR-014 and item 030 TAURI-006 (OCX-020).
- Local semantic thread summaries: ForgeLink derives an advisory, locally
  computed summary for any thread (what happened, open decisions, pending
  replies, last operator action, and agent-relevant constraints). Summaries are
  derived artifacts produced by a deterministic extractive pass — no model call —
  and cloud summarization is opt-in only and not enabled. Endpoint
  `GET /api/threads/:id/summary` (OCX-012).
- Injection-resistant summaries: thread content is treated as untrusted. Excerpts
  are sanitized and labeled, summaries carry explicit provenance and an advisory
  notice, always report `authority: "none"`, and can never grant authority or
  trigger actions; any future cloud summarizer must use the documented
  injection-resistant framing (OCX-019).
- Scoped agent/MCP resources: `get_pending_approvals`, `get_contact_summary`,
  `get_thread_summary`, and `get_agent_status` expose minimal, redacted, advisory
  views instead of raw communication history. No dump-all-messages resource
  exists; the scoped thread summary omits message excerpts, and contact summaries
  exclude bodies and phone numbers (OCX-013).
- Decision-first cockpit navigation: the desktop rail now starts with Decisions,
  People, Agents, and Channels. Messages, calls, and trusted signals remain
  reachable through Channels while approval requests are promoted to the
  Decisions surface and agent health is separate from the approval queue
  (OCX-001).
- Decision triage lanes and relationship-aware People grouping: the Decisions
  surface now separates needs-decision, waiting, informational, failed/repair,
  muted, expired, and completed agent work, while People groups contacts as
  operator, family, trusted humans, external contacts, agents, systems, unknown,
  and blocked with distinct treatment for unknown and blocked entries
  (OCX-002/003).
- Shared shell bridge alignment: the cockpit renderer now calls a ForgeLink-owned
  shell bridge, with Electron exposing `forgeLinkShell` while retaining the
  legacy `desktop` alias for compatibility, so the Decisions/People/Agents/
  Channels UI can move toward Tauri 2 without new Electron-only assumptions
  (OCX-021).
- Operator modes, local presence, and emergency boundaries: Settings now exposes
  availability modes, visible local presence signals, paired-mobile/DND controls,
  and emergency policy toggles; notification routing respects modes and
  presence, and agent emergency claims require governed emergency policy
  (OCX-004/005/006).
- Shared provider conformance test kit every SMS/MMS and voice edge adapter must
  pass, with Twilio and Telnyx wired through it (work item 015, CLV-021).
- Human Cards: resolvable local operator authority by alias (for example
  `operator:primary`), with redacted, agent-reachable resolution (work item 016,
  AGH-001).
- Authority scopes: approval requests can declare a required authority scope;
  under-authorized requests are rejected with escalation targets (AGH-002).
- Agent Identity Registry: agent-originated requests are tied to a first-class
  identity, and unknown agents are auto-registered with restricted defaults
  (AGH-003).
- Agent trust states and probation: muted/blocked agents cannot interrupt, only
  trusted agents may raise urgent interrupts, and every trust change is audited
  (AGH-004).
- Structured approval requests: `approval_request` agent messages now require and
  persist intent, requested action, interruption reason, risk, authority,
  affected resources, expiration behavior, denial behavior, and decision options
  (AGH-006).
- Evidence packs, approval templates, and approval dry-run simulation: governed
  requests now carry reviewable evidence, agents can inspect reusable playbooks,
  and agents can validate missing evidence/risk/channel guidance before
  interrupting the operator (AGH-007 through AGH-009).
- Risk-tiered interruption policy, timeout/escalation recording, and agent
  etiquette fields: approval requests now persist routing policy, escalation
  behavior, expected response time, no-response behavior, batching allowance, and
  expiry audit events (AGH-010 through AGH-012).
- Decision Records: operator approvals and dismissals of approval requests are
  persisted with the deciding operator/device, chosen options, comment, granted
  authority, and request/evidence/decision hashes, audited as a `decision` event,
  and replayable through operator-only endpoints. Records are written only from
  the local operator surface, so an agent cannot forge an operator decision
  (AGH-013).
- Tamper-evident audit chain: approval requests, evidence packs, operator
  decisions, and reported outcomes are committed to an append-only, hash-linked
  local chain. Each entry commits to the previous entry's hash, so editing any
  record or entry is detectable. Operators can list and verify the chain through
  operator-only endpoints; verification reports the first broken link, tampered
  entry, or tampered payload (AGH-016).
- Approval outcome callbacks: after a decision, agents report what happened
  (action started/succeeded/failed, expired, used with modified scope, or
  cancelled). ForgeLink flags scope mismatches when an agent acts outside the
  approved resources, keeps approvals that never reported a terminal outcome
  visible as "dangling," audits each outcome, and commits it to the audit chain.
  Agents report over their own token; outcome views are operator-only (AGH-015).
- Decision memory: ForgeLink detects when the same agent source, approval
  template, and required authority were decided the same way at least three times
  and offers it as a suggested policy. Suggestions require explicit operator
  confirmation (or dismissal); a confirmed rule is advisory only — it is never read
  by the approval path, so it never auto-decides or expands agent authority. The
  suggestion, confirm, dismiss, and rule-list endpoints are operator-only (AGH-014).
- Approval replay: operators can inspect the full lifecycle of an approval —
  request received, risk classified, evidence shown, decision made, actions
  reported, and final state — as an ordered, read-only view with the per-request
  audit-chain segment and a chain verification. Replay redacts according to
  operator policy: only the desktop_full profile shows private detail; previewing
  another profile (for example mobile_lock_screen) withholds it while keeping the
  lifecycle and integrity hashes. The replay endpoint is operator-only (AGH-017).
- Governance export: operators can export approval/audit history in a portable
  format for review. The export is redacted by default — credentials are never
  included, and message bodies, evidence packs, decision comments, and outcome
  summaries are excluded — and a full export with private detail requires explicit
  operator confirmation. The export endpoint is operator-only (AGH-018). This
  completes work item 016 Phase 5 (audit, replay, and integrity).
- Communication firewall: operators define how agents may communicate with humans
  and external channels (per agent, contact, and channel kind), with decisions of
  block, draft-only, require-approval, or allow. The most specific rule wins, ties
  break to the more restrictive decision, and the firewall is enforced before any
  external dispatch. Rule management and a dry-run evaluation are operator-only
  (AGH-019).
- Draft-don't-send for external channels: agents submit external messages over
  their channel credential, but the default posture parks them as drafts rather
  than sending. Operators review, edit, approve+send, or deny from a reviewed
  outbox; a block rule refuses outright and an allow rule grants explicit,
  audited direct-send authority. Every draft lifecycle step is audited (AGH-020).
- External-contact consent ledger: per-contact (and optionally per-agent) consent
  records cover allowed topics, channels, and hours, a review requirement, the
  consent source, and the last review. Unknown external contacts default to no
  direct agent contact, and an agent's external message only auto-sends when both
  the firewall allows it and consent permits it (AGH-021).
- Redaction profiles: canonical per-surface profiles (desktop full, mobile lock
  screen, email summary, SMS fallback, status only) decide how much of an evidence
  pack or notification a surface may reveal. The approval replay renders through
  the selected profile, an unknown profile fails closed to the most restrictive,
  and operators can list and preview profiles (AGH-022). This completes work item
  016 Phase 6 (communication firewall and consent).
- Public ingress hardening: the inbound webhook tunnel is now rate-limited
  (120/min) before signature handling, the residual attack surface is documented,
  and tests confirm only provider-signature-validated requests reach handlers while
  private routes stay credential-gated (AGH-023, decision 0003).
- Untrusted agent content: agent-supplied evidence, titles, and bodies are labeled
  agent-provided/unverified and sanitized (control, zero-width, and look-alike
  system/operator prefixes are neutralized) so they cannot impersonate ForgeLink UI
  or be auto-trusted (AGH-024).
- Decision/audit key management: a device-key registry records device identities
  and public-key references with rotation and lost-device revocation; private keys
  stay in OS-backed storage. The audit chain's guarantee is stated honestly as
  local tamper-evidence, not non-repudiation (AGH-025, decision 0016).
- Agent-facing governance contract (agent-governance-v1): a documented submit ->
  await -> outcome loop, with a redacted agent status poll and a capability
  discovery endpoint so ForgeWire Fabric can auto-detect ForgeLink as the governed
  HITL surface (AGH-026/028, decision 0004).
- ForgeWire Fabric HITL routing through ForgeLink: when ForgeLink is reachable,
  Fabric's hub auto-routes held approvals to ForgeLink's governed decision surface
  and reads the operator's decision back to resolve the held approval, with an
  operator opt-out and silent fallback to Fabric's built-in pane (AGH-028; Fabric
  side shipped in forgewire-fabric `fabric-hub`). The loop is closed end to end.
- End-to-end governance-loop integration test covering request -> risk -> evidence
  -> decision -> outcome -> audit -> replay (AGH-027). This completes work item 016
  Phase 7 and work item 016 in full (28 of 28 criteria satisfied).

### Changed
- Completed work item 015 (Communication Channels and Voice); moved to the
  completed ledger.
- Schema migrations now follow a single append-only ladder with per-version
  ownership recorded in decision 0011 (CLV-022). The local schema advanced from
  v10 to v20. Upgrades back up the database and are tested from previously shipped
  schemas.

## [2.0.3] - 2026-06-20 (local build, unsigned)

> Built locally as `Electron/dist/ForgeLink_2.0.3_x64-setup.exe`. Not published to
> GitHub Releases (still payment-locked); distribute the local installer directly.

### Changed
- Version bump to 2.0.3 and local rebuild/reinstall of the Windows installer. No
  functional changes over 2.0.2.

## [2.0.2] - 2026-06-18 (local build, unsigned)

> Built locally as `Electron/dist/ForgeLink_2.0.2_x64-setup.exe`
> (SHA-256 `5042bb82…0584d8e`). Not published to GitHub Releases — that route is
> currently payment-locked; distribute the local installer directly for now.

### Added
- Windows NSIS installer with desktop + Start Menu shortcuts (PR-014 in progress).
- Automatic public webhook via a bundled cloudflared quick-tunnel, so inbound SMS
  works without manual webhook setup (work item 014).
- Twilio-only first-run setup with guidance and links; host/port/webhook moved to
  an Advanced section (work item 013).
- Single-instance behaviour: a second launch focuses the first window and never
  starts a competing backend (PR-010).
- Backend lifecycle hardening: port-conflict detection with dynamic-port
  fallback, bounded crash-restart, lifecycle diagnostics, and a user-facing
  recovery message (PR-006).
- Support diagnostics endpoint (`/api/diagnostics`) reporting versions and status
  with credentials/messages/contacts/media excluded (PR-015).
- Security verification: proxy-aware webhook signature tests, local API threat
  tests, a git-tracked secret scanner (`npm run scan:secrets`), and a production
  dependency audit (`npm run scan:deps`) (PR-011).
- Installer/packaging completeness tests and an opt-in live-Twilio test (PR-013).
- Auto-update via electron-updater: a tested decision helper, a failure-tolerant
  guarded check in the main process (operator-disableable with
  `FORGELINK_DISABLE_UPDATES=1`), a GitHub publish config, and electron-updater
  bundled into the packaged build (verified in the asar). It delivers updates
  once a release feed (`latest.yml`) is published; the feed is held until signing
  so the channel is not unauthenticated.
- App version surfaced in desktop status and diagnostics.

### Known limitations
- The installer is **not yet code-signed**, so Windows SmartScreen warns on first
  run and auto-update is not yet trust-anchored. Signing closes PR-014; it
  requires a code-signing certificate.
- Auto-update is **bundled and wired but not yet delivering**: no release feed
  (`latest.yml`) is published, and the feed is intentionally held until signing
  so installed clients are never on an unauthenticated update channel. The
  updater path is guarded and never crashes the app.
- A dev-only `undici` advisory exists in the build toolchain; the shipped
  (production) dependency tree audits clean (`npm run scan:deps`).

## [2.0.1] - 2026-06-15

### Added
- Branded application icon.

## [2.0.0] - 2026-06-15

### Changed
- ForgeLink 2.0.0: Electron + React/TypeScript desktop client for Twilio SMS/MMS
  with a bundled TypeScript backend on Node's built-in SQLite, encrypted
  credential lifecycle, authenticated loopback API, and data-safety tooling.
