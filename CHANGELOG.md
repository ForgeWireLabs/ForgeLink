# Changelog

All notable changes to ForgeLink are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and ForgeLink uses semantic
versions tracked in `VERSION` and `Electron/package.json`.

## [Unreleased]

### Added
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
