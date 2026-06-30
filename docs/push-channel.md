# Push Notification Channel

Push is a provider-neutral ForgeLink channel for **alerting an operator that
something needs them** — not for carrying the conversation itself. ForgeLink owns
the private communication and governance state; the push provider is a dumb edge.
What leaves the device is decided by a redaction profile that defaults to
lock-screen-safe, and a push tap is never approval authority on its own.

## Shipped vs deferred (work item 019)

**Shipped:**
- Provider-neutral push contracts (PUSH-001): redacted outbound notification,
  device/topic identity, delivery attempts, disabled state, provider-error
  classification, and the optional signed action-response shape — not coupled to one
  provider.
- Provider strategy (PUSH-002, below): ntfy is the shipped path; the contracts let
  another provider implement `PushTransport` without touching the channel.
- Secure credential storage (PUSH-003): the topic **and** token are stored
  OS-encrypted (Electron `safeStorage`) in the main process — never in the database,
  logs, diagnostics, exports, or the renderer (which sees only presence flags).
  Re-saving with a new topic/token rotates the delivery identity; removing the
  credentials revokes it and disables the channel.
- Redaction profiles (PUSH-004): `lock_screen_safe` (default) emits only generic,
  category-derived text and never the caller's title/body; `full` emits clamped,
  control-stripped caller content and only when explicitly selected. Misconfiguration
  falls back to lock-screen-safe.
- Notification-only action boundary (PUSH-005, below): push ships **no** quick
  actions; a tap opens the cockpit, it never carries authority.
- Setup/test/status/revoke UI with a redaction preview (PUSH-006): a Settings "Push
  notifications" card shows redacted status, a credential form, a "Send test
  notification" button, revoke, and a preview of exactly what lock-screen-safe sends.
- Outbound send behind the channel registry: a `push_send` adapter with an
  injectable transport, registered only when a topic is configured.
- Deterministic test matrix (PUSH-007): default vs full redaction,
  control-char/header-injection stripping, send success, disabled-when-unconfigured,
  retryable vs permanent provider failure (incl. an invalid/stale token), registry
  selection by capability, encrypted-at-rest storage with rotation/revoke, redacted
  status, and diagnostics/export exclusion of the topic and token.

**Deferred:**
- **Provider-live verification:** the default `sendNtfyPush` transport is not yet
  verified against a live ntfy server. The logic ForgeLink relies on — redaction,
  validation, error classification, send orchestration — is pure and unit-tested with
  an injected transport.
- **Signed push quick actions:** intentionally not shipped (see PUSH-005 below). If
  they are ever added, they must use the signed `PushActionResponse` path.

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

## Action boundary (PUSH-005): notification-only

**Push ships no quick actions, by decision.** A push notification is a one-way alert;
it cannot approve, deny, or change any governance state. To act, the operator opens
the ForgeLink cockpit (or the first-party mobile cockpit) where the decision is made
through the already-signed, locally-validated path. This keeps the safe boundary that
PUSH-005 requires: a tapped notification is never authority on its own.

If push quick actions are ever introduced, they must reuse the signed
`PushActionResponse` contract (HMAC signature + expiry + nonce) and the same
server-side checks the email quick-action path uses (EMAIL-006): single-use
anti-replay, a real pending request lookup, and contact/agent policy — before
anything is applied. No unsigned push tap will ever carry authority.

## Operator setup (PUSH-008)

1. **Pick a topic.** Choose a long, hard-to-guess topic name (treat it like a
   password — on a shared server, anyone who knows the topic can read your alerts).
2. **Subscribe on your phone.** Install the ntfy app (or open the web app), and
   subscribe to that topic on your provider (`https://ntfy.sh` or your self-hosted
   instance). For private topics, configure access and create a token.
3. **Configure ForgeLink.** In Settings → **Push notifications**, enter the provider
   URL, the topic, and (optionally) the access token, choose a redaction profile
   (leave **Lock-screen-safe**), and save. Credentials are stored OS-encrypted and the
   local service restarts to apply them. (Headless/server installs can instead set
   `FORGELINK_PUSH_*` in the environment.)
4. **Send a test.** Click **Send test notification** and confirm it arrives on your
   phone.

### Configuration reference

Push is **disabled by default**; with no topic configured the channel is off and
sending throws.

| Variable | Meaning | Default |
| --- | --- | --- |
| `FORGELINK_PUSH_PROVIDER` | Provider key | `ntfy` |
| `FORGELINK_PUSH_URL` | Provider base URL (ntfy.sh or self-hosted) | `https://ntfy.sh` |
| `FORGELINK_PUSH_TOPIC` | Delivery topic/identity (required to enable) | _unset_ |
| `FORGELINK_PUSH_TOKEN` | Bearer token for access-controlled topics | _unset_ |
| `FORGELINK_PUSH_PROFILE` | `lock_screen_safe` or `full` | `lock_screen_safe` |

### Privacy limitations

- The default profile never sends message bodies, contact identifiers, or approval
  details — only generic per-category text (e.g. "An approval is waiting in
  ForgeLink."). Choosing `full` is a deliberate policy decision and still strips
  control characters and clamps length.
- A correlation `ref` (e.g. a pending request id) may be sent to link a tap back to a
  local lookup; it is sanitized to an opaque bounded token and carries no private
  content.
- The notification still transits your push provider's servers. On `ntfy.sh` (the
  public instance) lock-screen-safe text is non-sensitive by design; self-host if you
  want the edge fully under your control.

### Lost-device handling

If a phone subscribed to your topic is lost or stolen, **rotate or revoke** in
Settings → Push notifications:

- **Rotate:** save a new topic (and token); the old topic stops being used
  immediately, so the lost device no longer receives alerts.
- **Revoke:** click **Remove**; the stored credentials are deleted, the channel goes
  disabled, and nothing is sent until reconfigured.

Because the default payload is lock-screen-safe, a lost device exposes no private
communication content even before you rotate.

### Failure modes

- **Not configured:** the status card shows "disabled" and the test/send paths return
  a clear "not configured" error rather than sending.
- **Transient provider trouble** (timeouts, network errors, HTTP 429/5xx): classified
  as retryable; the caller sees a redacted "temporarily rejected" message.
- **Invalid/stale token or rejected topic** (HTTP 401/403): classified as permanent;
  the caller sees a redacted "rejected" message and should rotate the credentials. No
  provider response body is ever surfaced.

### Relationship to the first-party mobile cockpit

Push is the **alert**, not the cockpit. It tells you something needs attention; you
act in the ForgeLink cockpit. The first-party mobile cockpit (work item 030,
[decision 0017](../decisions/0017-mobile-is-a-full-cockpit.md)) is the full operator
surface — push complements it as a lightweight, lock-screen-safe nudge and never
replaces it or carries its authority.
