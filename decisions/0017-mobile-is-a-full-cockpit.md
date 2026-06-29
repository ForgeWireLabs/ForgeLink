---
id: 0017
title: Mobile ForgeLink Is a Full Cockpit, Not a Companion Terminal
status: accepted
date: 2026-06-29
supersedes: []
---

# 0017: Mobile ForgeLink Is a Full Cockpit, Not a Companion Terminal

## Context

Work item 030 (Tauri shared shell) and the Phase 2 framing in work item 017
described the first mobile surface as a "paired, redacted, signed decision
terminal" — approval cards plus a few decision actions, explicitly *not* a full
product. That framing was a deliberately narrow MVP, and OCX-007/008 shipped a
mobile decision-terminal surface against it.

Operator direction (Jeremy, 2026-06-29) corrects the long-term product target:
ForgeLink Desktop Cockpit and ForgeLink Mobile Cockpit should be essentially the
**same product**. Mobile should do everything desktop does where Android/iOS
reasonably allow it, built from the same shared React/Web cockpit, differing
mainly by shell/platform integration and a responsive mobile skin. The redacted
decision terminal remains useful, but as a *restricted mode/profile*, not the
whole mobile product.

This is enabled, not blocked, by the current architecture: the renderer already
talks to the shell through a single narrow contract (`ForgeLinkShellBridge` in
`Electron/renderer/src/shell.ts`, resolved from `window.forgeLinkShell` with the
legacy `window.desktop` alias), so the same cockpit can run under a Tauri shell
without forking the UI.

## Decision

1. **Mobile is a full operator cockpit.** The Tauri 2 mobile target is the same
   shared cockpit as desktop (Decisions, People, Agents, Channels, and the rest),
   in a mobile/responsive layout, with capabilities reduced only where a platform
   genuinely requires it — never reduced to approval cards by default.
2. **The decision terminal is a restricted mode/profile**, not the mobile product
   ceiling. It is the safe/lock-screen/restricted view (redacted alerts, approve/
   deny/defer/short-reply, signed return), selectable as a profile of the mobile
   cockpit. OCX-007/008 remain valid as that restricted mode's first implementation.
3. **One shared cockpit core; shells differ, products do not.** Desktop and mobile
   share the React/Web renderer and the `ForgeLinkShellBridge` contract. They
   differ by shell (Electron today, Tauri 2 target) and layout, not by feature set.
4. **No UI fork and no private-data mirror.** "Full cockpit" means mobile is a
   first-class *client* of the operator's local data over the authenticated local
   connection — not a second replicated private database on the device. The
   no-replication boundary from work item 030 stays; the companion-only ceiling
   does not.
5. **Desktop-as-source-of-truth language is stage-specific, not a permanent
   ceiling.** It reflects the current implementation stage (desktop runs the
   backend/database), not a cap on what mobile may eventually present.
6. **Future custom-Android-OS mode.** A later phase runs ForgeWire/Fabric/ForgeLink
   inside a custom Android OS exposing a phone-native cockpit and a remote operator
   control surface, with authority kept gated, audited, and never raw ADB/shell
   control. The cross-device read-only `operator-status` bridge (Moto One Hyper ROM
   lab) is the first integration point feeding that surface.

## Consequences

- Work item 030 is reframed: TAURI-001 and TAURI-004 target a **full mobile
  cockpit** with the decision terminal as a restricted mode; non-goals keep the
  no-fork and no-replication boundaries but drop the companion-only ceiling.
- Work item 017's shipped OCX-007/008 criteria are **not** rewritten (they are a
  satisfied historical record); they are reinterpreted as the restricted-mode MVP.
- `docs/operator-cockpit.md` and `docs/distribution-and-update-strategy.md` are
  reframed to describe a mobile cockpit with a restricted decision-terminal mode.
- The cross-repo Android/Fabric `operator-status` bridge contract is recorded in
  work item 030 as a planned consumer; ForgeLink treats its payload as untrusted,
  advisory, read-only device status that never grants authority (consistent with
  the OCX-013/019 scoped-resource rules).
- No new direct Electron dependencies are introduced; the bridge contract stays the
  single shell boundary so Tauri can implement it.
