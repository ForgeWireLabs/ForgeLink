---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
source_of_truth: work/active/019-push-notification-channel/README.md; work/active/019-push-notification-channel/work-item.json
---

# Work Item 019: Push Notification Channel

## Goal

Add a push notification channel that can alert an operator without leaking private communication data. Push is a notification path first, not a replacement for the local app or the future first-party mobile companion.

## Scope

- Redacted outbound notifications.
- Device/topic/provider credential lifecycle.
- Redaction previews and policy integration.
- Optional signed quick actions only after replay protection and local pending-action validation exist.
- Failure and delivery diagnostics that expose health without exposing private data.

## Non-Goals

- Do not replicate the local database to a push provider.
- Do not include raw message bodies, contact data, call details, or approval evidence in default payloads.
- Do not treat push taps as approval authority without signed local action checks.
- Do not make a third-party push provider the primary source of truth.

## Evidence Expectations

Evidence must prove redaction, token safety, disabled states, provider failure handling, replay protection if actions ship, and diagnostics exclusion.

