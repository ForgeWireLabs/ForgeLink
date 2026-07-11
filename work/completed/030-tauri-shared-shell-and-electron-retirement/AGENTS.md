# Tauri Shared Shell and Electron Retirement Planning Agent

## Scope

- Own planning and evidence for the Tauri 2 shared desktop/mobile shell, shared
  renderer bridge, Tauri desktop scaffold, Tauri mobile decision terminal,
  distribution/update strategy, and Electron retirement gate.
- Coordinate with work item 017 for operator cockpit UX and mobile decision
  flows.
- Coordinate with work item 011 for current release/signing/update constraints.
  Signing / 011 PR-014 is a public-distribution hardening gate, **not** a
  development blocker for this item (decision 0018): scaffolding, the app-bridge,
  and validation proceed on unsigned/dev builds; only signed public distribution
  waits on the operator-provided certificate.
- Coordinate with work items 015 and 016 for mobile protocol, governance,
  redaction, signed decisions, and device revocation.

## Required Checks

- Run `python .local/validate_system.py` after plan, manifest, audit, or ledger
  changes.
- Run renderer interaction tests after bridge or UI changes.
- Run Tauri-specific build/smoke checks once the Tauri shell exists.

## Security Rules

- Do not expose real contacts, private messages, provider IDs, credentials,
  approval evidence, or screenshots in fixtures or public assets.
- Do not remove Electron until the parity gate is satisfied with evidence.
- Do not create a separate mobile product UI when the shared cockpit UI can be
  adapted through responsive layout and platform capabilities.
- Do not let mobile replicate the private desktop database for the MVP.

## Definition of Done

A criterion is done only when implementation, automated checks, documentation,
rollback notes, platform limitations, and remaining-risk notes are recorded.
