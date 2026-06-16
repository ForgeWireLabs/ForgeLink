# 009 - Human Attention Policy

> **Status**: Deferred.
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

Close with policy unit tests, renderer tests, desktop notification tests or
smoke evidence, visual Settings validation, and docs explaining privacy
defaults.
