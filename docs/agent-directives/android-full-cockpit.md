# Agent Directive: Android ForgeLink Is the Full Cockpit

Status: active
Applies to: ForgeLink Android / Tauri 2 mobile work
Controlling decision: decisions/0017-mobile-is-a-full-cockpit.md
Controlling work item: work/active/030-tauri-shared-shell-and-electron-retirement/

## Directive

Agents must not reinterpret ForgeLink Android as a companion-only client, notification-only surface, approval-card-only terminal, or desktop-dependent remote control.

ForgeLink Android is a first-class ForgeLink cockpit target.

The product goal is desktop feature parity on the phone wherever Android platform constraints allow it:

- Decisions
- People
- Agents
- Channels
- Messages
- Settings
- Attention policy
- Governance/audit state
- Device/Fabric status
- Local-first operator workflows

The restricted mobile decision terminal remains valid only as a restricted mode/profile for lock-screen-safe or interruption-safe flows. It is not the product ceiling.

## Required agent behavior

When working on Android/mobile ForgeLink, agents must:

1. Treat desktop parity as the default target.
2. Preserve the shared React/Web cockpit unless a platform constraint requires a shell-specific adapter.
3. Identify Android constraints explicitly instead of silently downgrading scope.
4. Choose one of these outcomes for every desktop feature:
   - mobile-local implementation;
   - authenticated/service-assisted implementation;
   - deferred with blocker evidence.
5. Keep Electron desktop behavior green while Android parity advances.
6. Avoid raw ADB/shell authority, unaudited mutation paths, or secret leakage.
7. Avoid claiming mobile completion when only the restricted decision terminal, a status panel, or a demo shell works.

## Non-negotiable wording

Use:

> Android ForgeLink is the full first-class mobile cockpit.

Do not use as the product target:

- companion app
- mobile notifier
- approval terminal
- remote control shell
- status-only panel
- phone-side demo

Those may describe specific restricted modes or temporary evidence slices, but not the Android product goal.

## Current physical-device evidence

On 2026-07-07 America/Chicago, the ForgeLink Tauri 2 Android APK was built, locally signed, installed, and launched on the Moto One Hyper physical device:

- package: `com.forgewire.forgelink`
- model: `motorola_one_hyper`
- product/device: `def_retail` / `def`
- serial observed by ADB: `ZY227JQC67`

The installed app launched successfully. The observed bottom banner, "The local service is unavailable. Failed to fetch.", is not an install failure. It exposes the next parity gap: the Android app still depends on desktop/local-service assumptions for parts of the full cockpit runtime.

That gap must be treated as Android full-cockpit runtime work, not as evidence that Android should be downgraded to a companion app.