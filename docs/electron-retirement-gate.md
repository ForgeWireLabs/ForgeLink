# Electron Retirement Gate

Electron remains ForgeLink's compatibility shell until the Tauri 2 shell proves
parity with the current desktop workflows and release-critical OS integrations.

## Gate Checklist

Electron can be removed only after all of these are true and recorded in work
item 030 evidence:

- Tauri desktop starts the shared cockpit from `Electron/renderer` without a
  separate product UI.
- The Tauri shell bridge covers local service lifecycle, authenticated local API
  discovery, notifications, external navigation, secure settings, attention
  policy, MCP credentials, agent channels, email settings, and push settings.
- Onboarding and local-only startup work from a clean profile.
- Credential import, save, remove, and provider-optional local mode preserve the
  existing encrypted-storage behavior.
- Decisions, People, Agents, Channels, Settings, mobile cockpit, outbox, calls,
  signals, and data-safety workflows pass renderer parity tests.
- Data backup, export, restore-latest, retention, migration, and damaged-database
  recovery have explicit smoke evidence under Tauri.
- Deep links, notifications, diagnostics, and updater/distribution hooks have
  platform evidence for the supported desktop targets.
- Mobile Android/iOS builds run the shared cockpit as an authenticated local API
  client without replicating the private desktop database.
- The restricted mobile decision terminal preserves redaction, paired-device
  signed decisions, approve/deny/defer/request-more-info/short-reply actions,
  presence, emergency contact mode, and device revoke.
- Rollback is documented and leaves Electron packaging available until at least
  one signed/public Tauri distribution path is proven.

## Current Status

TAURI-003 through TAURI-005 introduce the scaffold and guardrails only:

- `Tauri/src-tauri` is a buildable Tauri 2 Rust shell skeleton.
- `Tauri/src-tauri/tauri.conf.json` points at the shared renderer output in
  `Electron/renderer`.
- `Tauri/src-tauri/capabilities/mobile-cockpit.json` records the mobile cockpit
  profile and blocks private database replication.
- `Electron/tauri-scaffold.test.js` guards the scaffold shape and confirms
  Electron remains present.

This does not remove Electron, claim signed distribution, or claim emulator/device
mobile smoke. Those remain later work under TAURI-006 and TAURI-007.
