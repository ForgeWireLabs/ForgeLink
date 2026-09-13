# Electron Retirement Gate

Electron remains ForgeLink's compatibility shell until the Tauri 2 shell proves
parity with the current desktop workflows and release-critical OS integrations.

## Gate Checklist

Electron can be removed only after all of these are true and recorded in WI032
evidence. WI030 established the foundation and gate; it remains historical input
and does not authorize removal:

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

WI030 established the shared-shell architecture and retirement gate. WI032 now
owns the parity evidence and the later Electron-retirement implementation; WI030
remains historical foundation evidence.

The current WI032 slice has moved the Tauri desktop local-service path beyond the
old scaffold:

- `Tauri/src-tauri/src/local_service.rs` owns a real desktop backend child,
  authenticated readiness, safe port fallback, bounded crash recovery, explicit
  stop/shutdown, and truthful degraded status.
- `Tauri/src-tauri/tauri.conf.json` points at the shared renderer output in
  `Electron/renderer` and stages a self-contained backend runtime resource for
  packaged builds.
- `Tauri/src-tauri/capabilities/mobile-cockpit.json` records the mobile cockpit
  profile and blocks private database replication.
- `Electron/tauri-lifecycle.test.js` and the Tauri Rust tests guard the lifecycle
  boundary and confirm Electron remains present.

TPR-001 and TPR-002 are tracked in
`work/active/032-tauri-production-parity-and-electron-retirement/README.md`, with
the exhaustive deletion checklist at
`work/active/032-tauri-production-parity-and-electron-retirement/local-artifacts/electron-tauri-parity-inventory.md`.
Credential stores, native notifications/deep links/single-instance behavior,
data-safety smoke, signed distribution, and packaged clean-machine validation
remain later criteria. This slice does not remove Electron or claim production
release readiness.

The Android emulator/operator-status evidence under WI030 remains historical and
does not prove a packaged mobile app or desktop-backend replication. Public signed
distribution and packaged clean-machine validation remain later WI032 work under
TPR-006 through TPR-008.
