# Push Notification Channel

Push is a provider-neutral ForgeLink channel for **alerting an operator that
something needs them** — not for carrying the conversation itself. ForgeLink owns
the private communication and governance state; the push provider is a dumb edge.
What leaves the device is decided by a redaction profile that defaults to
lock-screen-safe, and a push tap is never approval authority on its own.

## Shipped vs deferred (work item 019)

**Shipped (this slice):**
- Provider-neutral push contracts (PUSH-001): redacted outbound notification,
  device/topic identity, delivery attempts, disabled state, provider-error
  classification, and the optional signed action-response shape — not coupled to one
  provider.
- Provider strategy (PUSH-002, below): ntfy is the shipped path; the contracts let
  another provider implement `PushTransport` without touching the channel.
- Redaction profiles (PUSH-004): `lock_screen_safe` (default) emits only generic,
  category-derived text and never the caller's title/body; `full` emits clamped,
  control-stripped caller content and only when explicitly selected. Misconfiguration
  falls back to lock-screen-safe.
- Outbound send behind the channel registry: a `push_send` adapter with an
  injectable transport, registered only when a topic is configured. Deterministic
  test matrix (default vs full redaction, control-char/header-injection stripping,
  send success, disabled-when-unconfigured, retryable vs permanent provider failure,
  registry selection by capability).

**Deferred (later 019 slices):**
- Secure credential/device-token storage with rotation/revoke (PUSH-003) — the
  provider token will be stored OS-encrypted via Electron `safeStorage` in the main
  process, like the email secrets, never in the DB/renderer/diagnostics.
- Signed quick actions (PUSH-005) — only if push actions ship; would require signed
  action payloads, expiry, replay protection, local pending-action lookup,
  contact/agent policy checks, and durable outcome records (mirroring EMAIL-006).
- Push setup/test/status/revoke UI and redaction preview (PUSH-006).
- Persistence/audit/retention participation and an HTTP send route (part of PUSH-005
  /PUSH-007 follow-up).
- **Provider-live verification (deferred):** the default `sendNtfyPush` transport is
  not yet verified against a live ntfy server. The logic ForgeLink relies on —
  redaction, validation, error classification, send orchestration — is pure and
  unit-tested with an injected transport.

## Provider strategy (PUSH-002): ntfy

The shipped path is [ntfy](https://ntfy.sh) — a topic-based publish/subscribe
notifier — for reasons that fit ForgeLink's local-first boundary:

- **No per-user account or proprietary SDK.** Publishing is an HTTP POST to a topic
  URL; the operator's phone subscribes to that topic. Nothing about ForgeLink's data
  model leaks into a provider account system.
- **Self-hostable.** ntfy can run on the operator's own infrastructure, so the
  notification edge need not be a third party at all. `FORGELINK_PUSH_URL` points at
  `https://ntfy.sh` or a self-hosted instance.
- **Topic = delivery identity.** A hard-to-guess topic name is the addressing
  primitive; access-controlled topics add a bearer token (`FORGELINK_PUSH_TOKEN`).
- **Notification-only.** ntfy delivers a title/body/priority — exactly the
  lock-screen-safe surface push should expose — and nothing about it invites putting
  private state on the wire.

This is deliberately **not** "every push provider." It is a provider-neutral push
foundation with one sane, configurable, self-hostable path. APNs/FCM or a
first-party relay can be added later as additional `PushTransport` implementations
behind the same contracts.

## Configuration

Push is **disabled by default**; with no topic configured the channel is off and
sending throws. It is enabled per environment:

| Variable | Meaning | Default |
| --- | --- | --- |
| `FORGELINK_PUSH_PROVIDER` | Provider key | `ntfy` |
| `FORGELINK_PUSH_URL` | Provider base URL (ntfy.sh or self-hosted) | `https://ntfy.sh` |
| `FORGELINK_PUSH_TOPIC` | Delivery topic/identity (required to enable) | _unset_ |
| `FORGELINK_PUSH_TOKEN` | Bearer token for access-controlled topics | _unset_ |
| `FORGELINK_PUSH_PROFILE` | `lock_screen_safe` or `full` | `lock_screen_safe` |

## Privacy and safety boundary

- The default profile never sends message bodies, contact identifiers, or approval
  details. Choosing `full` is a deliberate policy decision and still strips control
  characters and clamps length.
- A correlation `ref` (e.g. a pending request id) may be sent to link a tap back to a
  local lookup; it is sanitized to an opaque bounded token and carries no private
  content.
- Push is a notification path, not a source of truth and not an approval channel. A
  tap conveys intent only; any future quick action must be signed and validated
  locally (PUSH-005) before it changes anything.
