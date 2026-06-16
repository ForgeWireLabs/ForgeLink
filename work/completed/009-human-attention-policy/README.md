# 009 - Human Attention Policy

> **Status**: Completed 2026-06-16.
> **Owners**: UI Agent, Desktop Agent, Backend Agent, Security Agent.
> **Depends on**: Work items `007` and `008`.

## Intent

Create one explicit policy layer for when ForgeLink interrupts a human. As SMS,
agent channels, and signals accumulate, notification behavior must remain
intentional and private rather than becoming another attention market.

## In Scope

- Central attention policy data model.
- Quiet hours.
- Urgency behavior.
- Source/channel mute and pause controls.
- Notification redaction defaults.
- Explicit override rules.
- Policy use by desktop notifications.
- Settings UI for policy inspection and adjustment.
- Tests for policy decisions.

## Out Of Scope

- Mobile push notification infrastructure.
- Public social ranking or engagement scoring.
- Cloud-hosted notification relay.

## Product Rules

- Direct human messages deserve clear handling, but not body leakage by default.
- Agent urgency must not bypass human-defined quiet rules without explicit
  policy.
- RSS/signals should be quiet by default unless promoted by a human rule.
- The policy should be understandable and inspectable, not a hidden algorithm.

## Closeout Evidence

Completed with:

- Central `Electron/attention.js` policy model for SMS, agent-channel messages,
  trusted signals, system notices, quiet hours, urgency, redaction, and muted
  source/channel IDs.
- Desktop notification IPC now evaluates the attention policy before showing an
  OS notification.
- Default behavior keeps RSS/trusted signals quiet, only interrupts for high or
  urgent agent messages, redacts notification bodies, and keeps direct SMS
  notifications body-free.
- Settings UI exposes explicit notification controls without engagement ranking
  or feed promotion controls.
- Attention policy persistence is stored with local settings and normalized on
  load/save.
- Evidence in `evidence/runs/20260616-human-attention-policy.json`.

## Verification

- `cd Electron && npm test`
- `cd Electron && npm run screenshot`
- `python scripts/validate_repo.py --root .`
- `python .local/validate_system.py`

## Security Notes

Notification bodies are redacted by default. Even if a human disables body
redaction, notification text is still scrubbed for Twilio account SIDs, ForgeLink
MCP/channel tokens, phone-number-like values, and URLs. Local desktop
notifications may still be visible to the operating system and notification
center, so future mobile or remote bridges must keep this policy as the gate
instead of adding separate interruption rules.
