---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-10
source_of_truth: work/completed/030-tauri-shared-shell-and-electron-retirement/README.md; work/completed/030-tauri-shared-shell-and-electron-retirement/work-item.json
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
- desktop as the source of truth for private local data *at the current stage*
  (the backend/database runs there) — not a permanent ceiling on what mobile may
  present;
- mobile as a **full operator cockpit** in a mobile/responsive layout, with the
  redacted, signed **decision terminal preserved as a restricted mode/profile**
  rather than the whole mobile product (see
  [decision 0017](../../../decisions/0017-mobile-is-a-full-cockpit.md));
- Electron as a temporary compatibility shell until Tauri reaches parity.

## Scope

- Tauri 2 architecture and migration plan.
- Shared renderer app-bridge boundary.
- Tauri desktop shell scaffold alongside Electron.
- Tauri mobile cockpit scaffold for Android/iOS (full cockpit, mobile layout),
  with the decision terminal as a restricted mode/profile.
- Secure storage, notification, deep-link, updater, and distribution boundaries.
- A cross-device read-only device/Fabric `operator-status` bridge contract that
  the mobile cockpit consumes (see "Planned operator-status bridge" below).
- Electron retirement criteria and rollback plan.

The target architecture and bridge boundary are recorded in
[`docs/tauri-shared-shell.md`](../../../docs/tauri-shared-shell.md).

## Relationship to Other Work

- Work item 011 owns the current production-readiness/release baseline. Its
  Electron release work remains useful for current manual desktop releases but
  must not become the long-term shell strategy. **011 PR-014 / code-signing is a
  public-distribution hardening gate, not a development blocker for this item**
  (see [decision 0018](../../../decisions/0018-signing-cert-is-a-distribution-gate-not-a-dev-blocker.md)):
  Tauri scaffolding, the app-bridge, and validation proceed on unsigned/dev builds;
  only signed public distribution waits on the operator-provided certificate.
- Work item 015 owns the communication runtime and mobile companion protocol
  foundation.
- Work item 016 owns governance semantics, decision records, audit/replay,
  redaction profiles, and device-key concepts used by mobile decisions.
- Work item 017 owns the operator cockpit UX and mobile decision experience.
  This item owns the shell migration that makes that UX shared across desktop
  and mobile.

## Non-Goals

- Do not remove Electron before Tauri reaches the explicit parity gate.
- Do not fork the UI into separate desktop and mobile products (one shared cockpit;
  shells and layout differ, the product does not).
- Do not reduce the mobile app to a companion / approval-cards-only terminal by
  default; the decision terminal is a restricted mode, not the ceiling.
- Do not make the mobile app a replicated private database mirror; it reads the
  operator's data as an authenticated client of the local connection.
- Do not bypass existing local API authentication, redaction profiles, device-key
  handling, or governance audit requirements.
- Do not publish unsigned or unauthenticated update channels.

## Priority Order

- [x] **TAURI-001 Record Tauri 2 target architecture.** One shared React/Web UI,
  Rust-native shell logic, platform plugins where needed, desktop source of truth
  at this stage, a **full mobile cockpit** (mobile layout) with the decision
  terminal as a restricted mode, and Electron temporary (per
  [decision 0017](../../../decisions/0017-mobile-is-a-full-cockpit.md)).
- [x] **TAURI-002 Add shared app bridge.** Renderer code should depend on a
  narrow ForgeLink bridge, not direct Electron APIs, for shell services.
- [x] **TAURI-003 Scaffold Tauri desktop shell.** Run the existing cockpit UI in
  Tauri 2 alongside Electron with startup and local API smoke coverage.
- [x] **TAURI-004 Build Tauri mobile cockpit.** Android/iOS app running the shared
  cockpit in a mobile layout — a full operator control surface where the platform
  reasonably allows it, as an authenticated client of the operator's local data
  (not a replicated private database). The paired, redacted, signed decision
  terminal is preserved as a restricted mode/profile, not the whole app.
- [x] **TAURI-005 Define Electron retirement gate.** Remove Electron only after
  Tauri covers current desktop workflows and release-critical OS integrations.
- [x] **TAURI-006 Define Tauri distribution/update strategy.** Coordinate signed
  desktop and mobile release paths with 011 PR-014 and 017 OCX-020. **Signed public
  distribution is a later hardening step gated on the operator-provided certificate
  (decision 0018); unsigned/dev builds are the acceptable near-term distribution for
  scaffolding and validation, so this does not block TAURI-001–005/007.**
- [x] **TAURI-007 Add validation and rollback evidence.** Automated bridge/shell
  tests plus mobile emulator/device evidence before closing.
- [x] **TAURI-008 Add the Android/Fabric operator-status consumer.** Type the
  read-only `operator-status` payload, capture a fixture from the live bridge,
  parse/normalize it (treating `ok:false`/malformed as degraded), and render an
  advisory "Android / Fabric Device Health" panel on the mobile cockpit path that
  never grants authority or triggers actions. (First consumer of the planned
  bridge above; runs in the current renderer regardless of shell.)
- [x] **TAURI-009 Add the operator-status transport endpoint.** A launch-only
  `GET /api/device/operator-status` that runs the operator-configured ROM lab
  wrapper (`FORGELINK_OPERATOR_STATUS_SCRIPT`, optional `..._SHELL`) with a
  strictly-validated `request_id` through an `execFile` arg array (no shell
  string), bounded by a timeout, returning the bridge JSON or a degraded
  `ok:false` body. Read-only, advisory, not MCP-reachable, and never a raw
  device/shell surface; the panel uses it for live "Check device status".

## Planned operator-status bridge

The future custom-Android-OS / ForgeWire ROM work (Moto One Hyper ROM lab) exposes
a read-only device/Fabric status bridge that the mobile cockpit consumes. ForgeLink
defines the desired first contract here so the Android side can implement against a
stable shape. ForgeLink treats every field as **untrusted, advisory, read-only
device status** — it is displayed, never used to grant authority or trigger
actions (same trust posture as the OCX-013/019 scoped resources).

Request (ForgeLink → bridge):

```json
{ "mode": "operator-status", "request_id": "<uuid>" }
```

Response (bridge → ForgeLink):

```json
{
  "ok": true,
  "target": "emulator-only",
  "authority": "readonly-emulator-inspection",
  "mode": "operator-status",
  "request_id": "<echoed>",
  "generated_at": "<iso8601>",
  "bridge_version": "<string>",
  "device": { "android_release": "", "sdk": "", "model": "", "hardware": "", "fingerprint": "" },
  "boot": { "completed": true },
  "network": { "summary": "" },
  "storage": { "summary": "" },
  "activity": { "current_user": "", "top_activity": "" },
  "packages": { "summary": "", "count": 0 }
}
```

Rules ForgeLink relies on:

- `authority` must always describe a read-only inspection tier; the bridge never
  exposes a mutation mode through this contract.
- All values are sanitized/coarse summaries — no secrets, no full package dumps, no
  raw logs; `summary` strings carry counts/state, not contents.
- A failure is `{ "ok": false, "mode": "operator-status", "request_id": "...",
  "error": "<reason>" }`; ForgeLink renders it as a degraded status, never a crash.
- Later modes (`fabric-service-status`, `forgelink-service-status`,
  `operator-session-status`, `local-agent-status`, `mobile-cockpit-health`) follow
  the same envelope (`ok`/`mode`/`request_id`/`authority`) and trust posture.

First ForgeLink consumer (shipped, TAURI-008/009): the "Android / Fabric Device
Health" panel on the mobile cockpit surface, fed by the launch-only
`GET /api/device/operator-status` transport (TAURI-009), which runs the
operator-configured wrapper script. Live data requires
`FORGELINK_OPERATOR_STATUS_SCRIPT` to point at the ROM lab wrapper
(`scripts/show_forgelink_operator_status.ps1`); until then the panel offers a
labeled sample and the transport returns a degraded `ok:false`. A compact desktop
**Agents** mirror remains planned.

## Security and Privacy Constraints

- The shared UI must keep surface-specific capabilities explicit. The decision
  terminal is a restricted mode that shows redacted decision state; the full mobile
  cockpit reads the operator's data as an authenticated client and must not receive
  a replicated private communication database.
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

## Closeout

Work item 030 is complete as of 2026-07-10.

It completed the Tauri shared-shell foundation and defined the Electron retirement
gate. It did **not** claim full production parity or remove Electron. Those remaining
steps are intentionally split into work item 032, **Tauri Production Parity and
Electron Retirement**.

Closeout boundaries:

- the shared React/Web cockpit and Tauri bridge/scaffolds are established;
- the mobile full-cockpit direction and restricted decision-terminal mode are locked;
- Tauri distribution, validation, and rollback contracts are recorded;
- Android emulator and physical-device launch evidence exists;
- Electron remains in place until work item 032 proves production parity;
- signed public distribution remains certificate-gated through work item 011 PR-014.

Rollback remains straightforward: retain the existing Electron compatibility shell
while Tauri parity work proceeds. No Electron files are removed by this closeout.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-29 | direction reframed | Recorded [decision 0017](../../../decisions/0017-mobile-is-a-full-cockpit.md): mobile is a full cockpit, decision terminal is a restricted mode. Reframed goal/scope/non-goals and TAURI-001/004, and added the planned read-only `operator-status` device/Fabric bridge contract. | No criterion closed; direction reframing recorded. |
| 2026-06-29 | responsive cockpit CSS | Responsive groundwork for the Tauri 2 mobile cockpit (decision 0017): cockpit metric/card grids use `auto-fit`/`minmax` columns and the two-pane content layouts (calls, signals, mobile terminal) stack below 760px, so the shared UI reflows from desktop down to phone-width. Verified live in the installed app — the Android/Fabric Device Health metric grid now reflows cleanly with no overlap. `Electron/renderer/styles.css`. | No criterion closed; layout groundwork for TAURI-004. |
| 2026-06-29 | TAURI-009 live smoke | End-to-end live verification against the proven-healthy moto-one-hyper emulator: started the backend with `FORGELINK_OPERATOR_STATUS_SCRIPT` set, hit `GET /api/device/operator-status?request_id=manual-forgelink-smoke-001` (port 5099, launch token) → HTTP 200 `ok:true` live payload (bridge_version `rom_lab.forgelink_operator_status.v1`, Android 15/SDK 35/ranchu, packages 40, live `generated_at` distinct from the sample). Fed the live payload through the panel's `parseOperatorStatus` → `online` → renders "Status: Online" from live data, not the fixture. No code changed. | Live seam confirmed (evidence 20260629-tauri009-operator-status-live-smoke). |
| 2026-06-29 | TAURI-009 complete | Added the launch-only operator-status transport: `GET /api/device/operator-status` runs the operator-configured ROM lab wrapper (`FORGELINK_OPERATOR_STATUS_SCRIPT`, optional `..._SHELL`) with a strictly-validated `request_id` via an `execFile` arg array (no shell string), bounded by a 10s timeout/1MB buffer, returning the bridge JSON or a degraded `ok:false` body; the runner is injectable for tests. Not MCP-reachable; no raw device/shell surface. The mobile Device Health panel now offers a live "Check device status" alongside the sample. `Electron/backend/src/server.ts`, `Electron/renderer/src/api.ts`, `App.tsx`; backend build, server tests (live runner, unsafe-request_id sanitization, launch-only 401, not-configured degraded), 37 renderer tests, full Electron suite, and RepoPact/local validation passed. | TAURI-009 satisfied (evidence 20260629-tauri009-operator-status-transport). Default is disabled until `FORGELINK_OPERATOR_STATUS_SCRIPT` is set. |
| 2026-06-29 | TAURI-008 complete | Added the Android/Fabric operator-status consumer for the mobile cockpit path: `AndroidOperatorStatus` type, a fixture captured from the live ROM lab bridge (`rom_lab.forgelink_operator_status.v1`), a pure `parseOperatorStatus` client that neutralizes untrusted text and treats `ok:false`/malformed as degraded, and an advisory read-only "Android / Fabric Device Health" panel on the mobile surface (`AndroidDeviceHealth`) that grants no authority and triggers no actions. `Electron/renderer/src/operatorStatus.ts`, `App.tsx`, `types.ts`; renderer build and 36 renderer interaction tests (incl. panel render + parser online/degraded) passed; full Electron suite and RepoPact/local validation passed. | TAURI-008 satisfied (evidence 20260629-tauri008-operator-status-consumer). Consumer ships in the current renderer; live data awaits a bridge transport. |
| 2026-07-03 | TAURI-001/002 complete | Recorded the Tauri 2 shared-shell architecture in `docs/tauri-shared-shell.md`: one shared React/Web cockpit, Rust-native Tauri shell logic, platform plugins only where needed, desktop/local backend as source of truth at this stage, mobile as a full cockpit with decision terminal as restricted mode, and Electron temporary until parity. Made the renderer bridge contract explicit with `SHELL_BRIDGE_CAPABILITIES` in `Electron/renderer/src/shell.ts`; renderer code already uses `forgeLinkShell`/`desktop` through the ForgeLink bridge, and tests assert the Tauri-required capability groups are backed by bridge methods. Renderer build, renderer tests, full Electron suite, and RepoPact/local validation passed. | TAURI-001 and TAURI-002 satisfied (evidence 20260703-tauri001-002-architecture-bridge). Next: TAURI-003 Tauri desktop shell scaffold. |
| 2026-07-03 | TAURI-003/004/005 complete | Added a Tauri 2 scaffold under `Tauri/`: config points at the existing `Electron/renderer` output, the Rust entrypoint registers ForgeLink shell-bridge commands for startup/local API discovery, notifications, navigation, settings, attention policy, MCP, agent channels, email, and push, and the renderer now routes through Tauri `invoke` when `window.__TAURI__` is present. Added the mobile cockpit capability profile (`mobile_lock_screen`, paired-device signed decisions, device revoke, no private DB replication) and the explicit Electron retirement gate in `docs/electron-retirement-gate.md`. Renderer build/tests, scaffold tests, Rust `cargo check`, full Electron suite, and RepoPact/local validation passed. | TAURI-003, TAURI-004, and TAURI-005 satisfied (evidence 20260703-tauri003-005-shell-scaffold). This is scaffold/parity-gate closure only; signed distribution, emulator/device smoke, and Electron removal remain later work. |
| 2026-07-03 | TAURI-006 complete | Added the Tauri distribution/update contract in `Tauri/distribution-plan.json` and `docs/tauri-distribution-update-strategy.md`: unsigned/dev Tauri builds are allowed only for scaffold, validation, and internal operator testing; public desktop release requires an operator-provided signing certificate, signed bundle/update manifest, checksums, rollback notes, and Tauri parity evidence; mobile updates go through TestFlight/App Store and Play tracks; no Tauri release path may replicate the private desktop database. Added `Electron/tauri-distribution.test.js` to enforce the contract in `npm test` and cross-linked the existing distribution strategy. | TAURI-006 satisfied (evidence 20260703-tauri006-distribution-update-strategy). This does not claim a signed Tauri release, published updater feed, store submission, or Electron removal. |
| 2026-07-03 | TAURI-007 complete | Added `Tauri/validation-rollback-evidence.json` and `docs/tauri-validation-rollback-evidence.md` as the validation/rollback matrix for the shared bridge, Tauri desktop shell, mobile decision flow, distribution/update guards, and rollback path. Added Tauri command-level Rust smoke tests and `Electron/tauri-validation.test.js` to enforce the matrix in `npm test`. Renderer build/tests, Tauri scaffold/distribution/validation tests, Rust `cargo check`, Rust `cargo test`, full Electron suite, and RepoPact/local validation passed. | TAURI-007 satisfied (evidence 20260703-tauri007-validation-rollback). Mobile renderer decision-flow coverage is automated; a follow-up host pass proved the live Android emulator/operator-status seam (evidence 20260703-tauri007-android-emulator-smoke). Packaged Tauri APK/IPA device smoke remains required before public/mobile shipping. |
| 2026-07-03 | TAURI-007 Android emulator smoke | Started AVD `forge_moto_one_hyper_lab_api35` from `C:\Android\Sdk`, waited for `sys.boot_completed=1`, confirmed Android 15 / SDK 35 / `ranchu`, and ran `C:\Projects\moto-one-hyper\scripts\show_forgelink_operator_status.ps1 -RequestId tauri007-emulator-smoke-001`. The bridge returned `ok:true`, `authority: readonly-emulator-inspection`, `bridge_version: rom_lab.forgelink_operator_status.v1`, boot completed, package count 40, and sanitized network/storage/activity summaries. | Live read-only Android emulator/device-health seam confirmed (evidence 20260703-tauri007-android-emulator-smoke). No raw device mutation, APK install, or private DB replication claimed. |
| 2026-07-07 | Physical Moto One Hyper APK smoke + scope enforcement | Built the Tauri 2 Android APK, locally signed it with the local-only ForgeLink dev keystore, installed it on the physical Moto One Hyper (`motorola_one_hyper`, `def_retail`, package `com.forgewire.forgelink`), and launched it successfully through ADB/monkey. The visible mobile banner "The local service is unavailable. Failed to fetch." is recorded as the next full-cockpit runtime parity gap, not as a reason to downgrade Android to a companion/approval-only client. Added `docs/agent-directives/android-full-cockpit.md` to make decision 0017 and work item 030 binding for future agents. | Physical APK install/launch path proven. Next work: Android full-cockpit runtime parity, beginning with mobile-safe handling/replacement of desktop-local-service assumptions. |
| 2026-07-10 | work-item closeout | All TAURI-001 through TAURI-009 criteria are satisfied; ledger scope was reconciled and remaining production parity/Electron removal transferred to work item 032. | Work item 030 completed without removing Electron. |
