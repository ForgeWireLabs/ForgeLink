---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-30
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
- [ ] **TAURI-003 Scaffold Tauri desktop shell.** Run the existing cockpit UI in
  Tauri 2 alongside Electron with startup and local API smoke coverage.
- [ ] **TAURI-004 Build Tauri mobile cockpit.** Android/iOS app running the shared
  cockpit in a mobile layout — a full operator control surface where the platform
  reasonably allows it, as an authenticated client of the operator's local data
  (not a replicated private database). The paired, redacted, signed decision
  terminal is preserved as a restricted mode/profile, not the whole app.
- [ ] **TAURI-005 Define Electron retirement gate.** Remove Electron only after
  Tauri covers current desktop workflows and release-critical OS integrations.
- [ ] **TAURI-006 Define Tauri distribution/update strategy.** Coordinate signed
  desktop and mobile release paths with 011 PR-014 and 017 OCX-020. **Signed public
  distribution is a later hardening step gated on the operator-provided certificate
  (decision 0018); unsigned/dev builds are the acceptable near-term distribution for
  scaffolding and validation, so this does not block TAURI-001–005/007.**
- [ ] **TAURI-007 Add validation and rollback evidence.** Automated bridge/shell
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

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-29 | direction reframed | Recorded [decision 0017](../../../decisions/0017-mobile-is-a-full-cockpit.md): mobile is a full cockpit, decision terminal is a restricted mode. Reframed goal/scope/non-goals and TAURI-001/004, and added the planned read-only `operator-status` device/Fabric bridge contract. | No criterion closed; direction reframing recorded. |
| 2026-06-29 | responsive cockpit CSS | Responsive groundwork for the Tauri 2 mobile cockpit (decision 0017): cockpit metric/card grids use `auto-fit`/`minmax` columns and the two-pane content layouts (calls, signals, mobile terminal) stack below 760px, so the shared UI reflows from desktop down to phone-width. Verified live in the installed app — the Android/Fabric Device Health metric grid now reflows cleanly with no overlap. `Electron/renderer/styles.css`. | No criterion closed; layout groundwork for TAURI-004. |
| 2026-06-29 | TAURI-009 live smoke | End-to-end live verification against the proven-healthy moto-one-hyper emulator: started the backend with `FORGELINK_OPERATOR_STATUS_SCRIPT` set, hit `GET /api/device/operator-status?request_id=manual-forgelink-smoke-001` (port 5099, launch token) → HTTP 200 `ok:true` live payload (bridge_version `rom_lab.forgelink_operator_status.v1`, Android 15/SDK 35/ranchu, packages 40, live `generated_at` distinct from the sample). Fed the live payload through the panel's `parseOperatorStatus` → `online` → renders "Status: Online" from live data, not the fixture. No code changed. | Live seam confirmed (evidence 20260629-tauri009-operator-status-live-smoke). |
| 2026-06-29 | TAURI-009 complete | Added the launch-only operator-status transport: `GET /api/device/operator-status` runs the operator-configured ROM lab wrapper (`FORGELINK_OPERATOR_STATUS_SCRIPT`, optional `..._SHELL`) with a strictly-validated `request_id` via an `execFile` arg array (no shell string), bounded by a 10s timeout/1MB buffer, returning the bridge JSON or a degraded `ok:false` body; the runner is injectable for tests. Not MCP-reachable; no raw device/shell surface. The mobile Device Health panel now offers a live "Check device status" alongside the sample. `Electron/backend/src/server.ts`, `Electron/renderer/src/api.ts`, `App.tsx`; backend build, server tests (live runner, unsafe-request_id sanitization, launch-only 401, not-configured degraded), 37 renderer tests, full Electron suite, and RepoPact/local validation passed. | TAURI-009 satisfied (evidence 20260629-tauri009-operator-status-transport). Default is disabled until `FORGELINK_OPERATOR_STATUS_SCRIPT` is set. |
| 2026-06-29 | TAURI-008 complete | Added the Android/Fabric operator-status consumer for the mobile cockpit path: `AndroidOperatorStatus` type, a fixture captured from the live ROM lab bridge (`rom_lab.forgelink_operator_status.v1`), a pure `parseOperatorStatus` client that neutralizes untrusted text and treats `ok:false`/malformed as degraded, and an advisory read-only "Android / Fabric Device Health" panel on the mobile surface (`AndroidDeviceHealth`) that grants no authority and triggers no actions. `Electron/renderer/src/operatorStatus.ts`, `App.tsx`, `types.ts`; renderer build and 36 renderer interaction tests (incl. panel render + parser online/degraded) passed; full Electron suite and RepoPact/local validation passed. | TAURI-008 satisfied (evidence 20260629-tauri008-operator-status-consumer). Consumer ships in the current renderer; live data awaits a bridge transport. |
| 2026-07-03 | TAURI-001/002 complete | Recorded the Tauri 2 shared-shell architecture in `docs/tauri-shared-shell.md`: one shared React/Web cockpit, Rust-native Tauri shell logic, platform plugins only where needed, desktop/local backend as source of truth at this stage, mobile as a full cockpit with decision terminal as restricted mode, and Electron temporary until parity. Made the renderer bridge contract explicit with `SHELL_BRIDGE_CAPABILITIES` in `Electron/renderer/src/shell.ts`; renderer code already uses `forgeLinkShell`/`desktop` through the ForgeLink bridge, and tests assert the Tauri-required capability groups are backed by bridge methods. Renderer build, renderer tests, full Electron suite, and RepoPact/local validation passed. | TAURI-001 and TAURI-002 satisfied (evidence 20260703-tauri001-002-architecture-bridge). Next: TAURI-003 Tauri desktop shell scaffold. |
