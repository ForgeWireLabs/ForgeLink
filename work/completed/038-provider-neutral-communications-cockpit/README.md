---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-26
source_of_truth: README.md; work-item.json
---

# Work Item 038: Provider-Neutral Communications Cockpit

## Goal

Make ForgeLink itself—not Twilio—the center of the communications cockpit. Shared
message, channel, approval, health, and settings surfaces must remain neutral until
an operator explicitly selects a ready SMS/MMS edge. Provider-specific configuration
must stay distinct because Twilio and Telnyx have different credentials, webhook
models, capabilities, and operator portals.

## Corrective gap

Work item 036 added separate provider flows but retained several Twilio-era defaults:

- an installation without telecom credentials still reports Twilio as selected;
- the Settings hierarchy presents the Twilio connection before the shared provider
  overview and Telnyx configuration;
- removing Telnyx silently selects Twilio even when Twilio is unavailable;
- shared compose and outbox labels assume the selected experience is always a
  telecom provider;
- local-only is an onboarding action, not a durable provider-selection state.

## Product contract

- **Local-only is first-class.** No telecom provider is selected, external SMS/MMS
  send controls are unavailable, and ForgeLink's local inbox, agent, approval, and
  governance workflows remain usable.
- **Shared surfaces are neutral.** They show the active edge only when one is
  explicitly selected and ready.
- **Provider setup stays specific.** Twilio retains its Account SID/Auth Token,
  per-number webhook, console, and current Voice edge. Telnyx retains its API key,
  messaging profile, Ed25519 webhook, portal, and SMS/MMS-only shipped scope.
- **Removal is honest.** Removing one provider chooses another only when it is
  actually configured; otherwise ForgeLink returns to local-only.

## Acceptance criteria

- [x] **PNC-001** Add a first-class no-provider/local-only selection state.
- [x] **PNC-002** Generalize all shared communications surfaces.
- [x] **PNC-003** Present Twilio and Telnyx with equal configuration hierarchy.
- [x] **PNC-004** Make removal, switching, and send gates honest and reversible.
- [x] **PNC-005** Prove renderer, desktop, backend, package, reinstall, docs, and governance behavior.

## Evidence log

| Evidence | Criteria | Result |
| --- | --- | --- |
| `20260726-provider-neutral-communications-cockpit` | PNC-001 through PNC-005 | Passed state/store/backend/renderer tests, full regression, package build, replacement install, authenticated packaged health, secret scan, Tauri compile, and governed validation. |

## Closeout

Completed on 2026-07-26. ForgeLink now persists `none` as a real SMS/MMS
selection, presents the neutral provider overview before equal-hierarchy Twilio and
Telnyx cards, and keeps provider-specific credentials, webhooks, portals, and Voice
capability boundaries intact. Shared channel, compose, new-message, and reviewed
outbox surfaces no longer name an unavailable provider. Removing Telnyx falls back
to Twilio only when Twilio is configured, and local-only blocks external sends at
both the renderer and backend boundaries. Restarting the stopped local service uses
a neutral lifecycle action and preserves the current provider selection.

The Windows 2.0.3 installer was rebuilt and replacement-installed locally. The
installed app launched successfully, returned authenticated Node backend health on
loopback, and retained the required unpacked backend runtime dependencies. No live
provider calls or private communication data were used. The final rebuilt package,
including the neutral restart action, also passed authenticated health from
`dist/win-unpacked`; Windows canceled two subsequent elevation prompts, so rerunning
the final NSIS installer remains necessary to replace the Program Files shortcut
copy with that last package revision.

## Rollback

Revert this slice as one unit. Existing encrypted Twilio and Telnyx credentials and
the local SQLite store are not deleted by provider-selection changes. A rollback may
restore the earlier Twilio default, but must not alter provider account resources or
message history.
