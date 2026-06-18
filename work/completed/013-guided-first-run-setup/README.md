---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-17
source_of_truth: Electron/renderer/src/App.tsx
---

# Work Item 013: Guided first-run setup

## Goal

A new, unfamiliar user who installs ForgeLink and lands on the first-run "Connect
your Twilio account" screen should be able to complete it without prior Twilio
knowledge — the screen should say where each value comes from and link out to the
right Twilio pages.

## Why

Field-tested gap: the setup modal asks for Account SID, Auth token, Twilio number,
and "Public webhook URL" with no explanation. A first-time user has no idea where
to get those or what a webhook URL is, and bounces.

## Scope

- `Electron/renderer/src/App.tsx` `ConnectionModal`: add a short first-run helper
  with links (Twilio signup + Console) and enrich each Twilio field's hint with
  where to find the value; widen `Field`'s `hint` to `ReactNode` so hints can
  carry links, and move the hint outside the `<label>` so it no longer pollutes
  the field's accessible name.
- Per the operator's direction, **only Twilio fields** (Account SID, Auth token,
  Twilio number) are first-run; Public webhook URL, Local host, and Local port
  move into a collapsed Advanced section as automatic/optional. The webhook is
  inbound-only; full auto-provisioning of the public tunnel is follow-on work.
- `Electron/renderer/styles.css`: minimal styling for the helper block, links,
  and the Advanced section.
- No personal data hardcoded; field labels unchanged so interaction tests hold.

## Acceptance

Lifecycle and evidence live in [`work-item.json`](work-item.json).

## Closeout

See evidence run `20260617-guided-first-run-setup`.
