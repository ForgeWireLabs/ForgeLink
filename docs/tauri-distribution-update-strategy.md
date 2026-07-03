# Tauri Distribution And Update Strategy

TAURI-006 defines the Tauri-owned distribution contract for ForgeLink's shared
desktop/mobile shell. It refines the cross-surface strategy in
[`docs/distribution-and-update-strategy.md`](distribution-and-update-strategy.md)
and keeps the public signing gate from stalling scaffold and validation work.

## Contract Artifact

The machine-readable plan lives in
[`Tauri/distribution-plan.json`](../Tauri/distribution-plan.json). It is checked
by `Electron/tauri-distribution.test.js` and included in `npm test`.

The plan makes four commitments explicit:

- unsigned Tauri builds are allowed for development, validation, and internal
  operator testing only;
- public desktop release requires an operator-provided signing certificate,
  signed bundle/installer, signed update manifest, checksums, rollback notes, and
  Tauri parity evidence;
- public mobile release uses platform signing and store-controlled update tracks;
- no distribution or update path turns mobile into a replicated private database.

## Desktop Path

Tauri desktop inherits the release trust model from work item 011 PR-014:

- the shared cockpit renderer remains `Electron/renderer` until Electron is
  retired by the TAURI-005 parity gate;
- public desktop distribution waits on signed Tauri installers/bundles and a
  signed update manifest;
- Do not publish an unsigned Tauri update feed; a Tauri updater feed may not be
  published while unsigned;
- `FORGELINK_DISABLE_UPDATES` remains the operator opt-out environment variable;
- Electron remains available as the compatibility shell until Tauri has parity
  and at least one signed/public Tauri distribution path is proven.

Near-term `cargo check`, Tauri dev runs, and unsigned/internal smoke builds are
valid TAURI-007 evidence. They are not public releases.

## Mobile Path

Mobile Tauri releases are store-owned:

- iOS pre-release goes through TestFlight, then App Store for public release;
- Android pre-release goes through Play internal or closed testing, then the Play
  production track;
- native capability updates must go through the platform review/signing path;
- self-hosted native update feeds and over-the-air native capability updates are
  not allowed for the MVP.

The mobile cockpit remains an authenticated client of the operator's local
connection. Its restricted decision terminal profile is `mobile_lock_screen`, and
decisions return as signed envelopes. Private desktop data is not replicated to a
mobile database by the release or update path.

## Rollback

Desktop rollback uses prior signed installers/bundles plus managed local backups.
Mobile rollback uses platform track controls and staged rollout rollback. Data
rollback stays governed by ForgeLink's managed backup, export, retention, and
schema-migration ladder.

## Current Limits

This closes the distribution/update strategy criterion only. It does not claim a
signed Tauri release, a published Tauri updater feed, mobile store submission, or
Electron removal.
