# Changelog

All notable changes to ForgeLink are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and ForgeLink uses semantic
versions tracked in `VERSION` and `Electron/package.json`.

## [Unreleased]

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
- Auto-update wiring via electron-updater, active in packaged builds and
  operator-disableable with `FORGELINK_DISABLE_UPDATES=1` (PR-014).
- App version surfaced in desktop status and diagnostics.

### Known limitations
- The installer is **not yet code-signed**, so Windows SmartScreen warns on first
  run and auto-update is not yet trust-anchored. Signing closes PR-014; it
  requires a code-signing certificate.
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
