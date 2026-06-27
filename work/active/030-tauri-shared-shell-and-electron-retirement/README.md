---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-27
source_of_truth: work/active/030-tauri-shared-shell-and-electron-retirement/README.md; work/active/030-tauri-shared-shell-and-electron-retirement/work-item.json
---

# Work Item 030: Tauri Shared Shell and Electron Retirement

## Goal

Make Tauri 2 the target ForgeLink shell for desktop and mobile, using one shared
operator UI while retiring Electron after real parity.

This item exists because Phase 2 of work item 017 should not create a throwaway
mobile companion or deepen the Electron-only desktop surface. ForgeLink should
move toward:

- one shared React/Web cockpit UI;
- Rust-native shell logic through Tauri 2;
- platform-specific Swift/Kotlin plugins only where mobile or OS integration
  requires them;
- desktop as the source of truth for private local data;
- mobile as a paired, redacted, signed decision terminal;
- Electron as a temporary compatibility shell until Tauri reaches parity.

## Scope

- Tauri 2 architecture and migration plan.
- Shared renderer app-bridge boundary.
- Tauri desktop shell scaffold alongside Electron.
- Tauri mobile decision-terminal scaffold for Android/iOS.
- Secure storage, notification, deep-link, updater, and distribution boundaries.
- Electron retirement criteria and rollback plan.

## Relationship to Other Work

- Work item 011 owns the current production-readiness/release baseline. Its
  Electron release work remains useful for current manual desktop releases but
  must not become the long-term shell strategy.
- Work item 015 owns the communication runtime and mobile companion protocol
  foundation.
- Work item 016 owns governance semantics, decision records, audit/replay,
  redaction profiles, and device-key concepts used by mobile decisions.
- Work item 017 owns the operator cockpit UX and mobile decision experience.
  This item owns the shell migration that makes that UX shared across desktop
  and mobile.

## Non-Goals

- Do not remove Electron before Tauri reaches the explicit parity gate.
- Do not fork the UI into separate desktop and mobile products.
- Do not make the mobile app a private database mirror.
- Do not bypass existing local API authentication, redaction profiles, device-key
  handling, or governance audit requirements.
- Do not publish unsigned or unauthenticated update channels.

## Priority Order

- [ ] **TAURI-001 Record Tauri 2 target architecture.** One shared React/Web UI,
  Rust-native shell logic, platform plugins where needed, desktop source of
  truth, mobile decision terminal, Electron temporary.
- [ ] **TAURI-002 Add shared app bridge.** Renderer code should depend on a
  narrow ForgeLink bridge, not direct Electron APIs, for shell services.
- [ ] **TAURI-003 Scaffold Tauri desktop shell.** Run the existing cockpit UI in
  Tauri 2 alongside Electron with startup and local API smoke coverage.
- [ ] **TAURI-004 Build Tauri mobile decision terminal.** Android/iOS app focused
  on paired, redacted, signed decisions without database replication.
- [ ] **TAURI-005 Define Electron retirement gate.** Remove Electron only after
  Tauri covers current desktop workflows and release-critical OS integrations.
- [ ] **TAURI-006 Define Tauri distribution/update strategy.** Coordinate signed
  desktop and mobile release paths with 011 PR-014 and 017 OCX-020.
- [ ] **TAURI-007 Add validation and rollback evidence.** Automated bridge/shell
  tests plus mobile emulator/device evidence before closing.

## Security and Privacy Constraints

- The shared UI must keep surface-specific capabilities explicit. Mobile can show
  redacted decision state; it must not receive a full private communication
  mirror.
- All shell bridges must be least-privilege and auditable.
- Secrets stay in OS-backed storage appropriate to the platform and must never be
  exposed to renderer logs, diagnostics, screenshots, exports, or public assets.
- Mobile decisions must respect the governance records, audit chain, redaction
  profiles, and device-key/revocation model from work item 016.

## Evidence Expectations

Evidence must include architecture notes, bridge contract tests, renderer
interaction tests, Tauri desktop smoke evidence, mobile decision-flow evidence
from emulator/device or a documented waiver, distribution/update notes, rollback
notes, and `python .local/validate_system.py`.

