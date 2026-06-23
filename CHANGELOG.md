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

### Changed
- Completed work item 015 (Communication Channels and Voice); moved to the
  completed ledger.
- Schema migrations now follow a single append-only ladder with per-version
  ownership recorded in decision 0011 (CLV-022). The local schema advanced from
  v10 to v15. Upgrades back up the database and are tested from previously shipped
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
