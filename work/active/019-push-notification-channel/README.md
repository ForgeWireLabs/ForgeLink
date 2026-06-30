---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-30
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

## Progress

### Foundation slice — 2026-06-30 (evidence `20260630-push-001-002-004-foundation`)

Satisfied **PUSH-001**, **PUSH-002**, **PUSH-004**:

- **PUSH-001** — provider-neutral push contracts in
  [`Electron/backend/src/push.ts`](../../../Electron/backend/src/push.ts):
  `PushNotification` (pre-redaction source), `RedactedPush` (wire shape), disabled
  state, `mapPushError` retryable/permanent classification, and the optional
  `PushActionResponse` signed-action shape (defined, not yet wired). New `push_send`
  capability on the channel registry.
- **PUSH-002** — ntfy chosen and documented in
  [`docs/push-channel.md`](../../../docs/push-channel.md): topic-based, no per-user
  account, self-hostable — fits the local-first boundary. Deliberately not "every
  push provider"; one configurable path behind a provider-neutral `PushTransport`.
- **PUSH-004** — redaction profiles: `lock_screen_safe` (default) never emits the
  caller's title/body, only generic category text; `full` emits clamped,
  control-stripped content and only when explicitly selected; misconfiguration falls
  back to safe. Correlation `ref` sanitized to an opaque bounded token.
- Outbound send behind the registry via `createPushAdapter` (injectable transport;
  default `sendNtfyPush`), registered in `server.ts` only when `pushConfigured()`.
- Deterministic tests in
  [`Electron/backend/src/push.test.ts`](../../../Electron/backend/src/push.test.ts)
  (12 cases).

**Pending after this slice:** PUSH-003 (credential/device-token storage with
rotation/revoke), PUSH-005 (signed quick actions, only if actions ship), PUSH-006
(setup/test/status/revoke UI + redaction preview), PUSH-007 (full test matrix —
delivery/redaction/missing-creds/provider-outage are covered, but stale-token,
duplicate-action-tap, and diagnostics-exclusion tests depend on the deferred
storage/actions/diagnostics slices), PUSH-008 (operator docs). Default ntfy transport
live verification is deferred; relied-on logic is unit-tested with an injected
transport. No effect on work items 011 or 030.

