# Tauri Validation And Rollback Evidence

TAURI-007 closes the validation and rollback evidence slice for the current
Tauri scaffold. It proves the shared shell boundary and Tauri scaffold with
automated checks, and records what is still not claimed.

## Automated Coverage

The executable matrix is stored in
[`Tauri/validation-rollback-evidence.json`](../Tauri/validation-rollback-evidence.json)
and enforced by `Electron/tauri-validation.test.js`.

Covered checks:

- Shared bridge: renderer tests prove the app prefers `forgeLinkShell`, routes
  through Tauri `invoke` when `window.__TAURI__` is present, and keeps the Tauri
  capability list backed by bridge methods.
- Desktop scaffold: `cargo check`, `cargo test`, and
  `Electron/tauri-scaffold.test.js` prove the Tauri crate compiles, shell command
  shapes are renderer-safe, the shared renderer is reused, and Electron remains.
- Mobile decision flow: renderer tests cover the Tauri mobile decision terminal
  flow, redacted `mobile_lock_screen` profile, paired-device signed-decision
  intent, device revoke control, and no private database replication.
- Distribution/update guard: `Electron/tauri-distribution.test.js` proves
  unsigned Tauri builds stay internal, public desktop updater feeds are signing
  held, and mobile updates remain store-owned.
- Governance: `python .local/validate_system.py` validates RepoPact records,
  evidence links, schema-ladder invariants, and docs links.

## Rollback

Do not remove Electron as part of this slice. Electron remains the supported compatibility shell until the TAURI-005 retirement gate is satisfied with real
parity and public distribution evidence.

Rollback path for this scaffold:

- keep shipping the current Electron shell;
- ignore or remove `Tauri/` without data conversion;
- restore the previous work-item state if the scaffold has to be backed out;
- use managed backups, exports, retention, and schema migration safeguards for
  local data rollback;
- do not publish a Tauri updater feed or mobile build until signing and store
  evidence are present.

No database schema, credential-store migration, provider migration, or private
data migration is introduced by TAURI-007.

## Current Limits

This pass does not claim Android/iOS emulator or physical-device smoke. The
renderer mobile decision flow is covered, but public/mobile shipping still needs
device evidence for pairing, authenticated local API connection, notifications,
deep links, signed decision envelope return, and device revoke.

Signed Tauri desktop release, signed updater feed, mobile store submission, and
Electron removal remain outside this slice.
