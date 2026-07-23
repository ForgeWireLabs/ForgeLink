# ForgeLink communications runtime (work item 015, CLV-001)

ForgeLink's product center is **governed human communication state**, not any one
telecom provider. This document defines the ForgeLink-owned runtime model and the
boundary between it and external transport/provider state. Channels are adapters;
the core is useful even when no telecom provider is configured.

## The boundary

```text
ForgeLink-owned communication state            External transport / provider state
(durable, local, provider-neutral)             (ephemeral wire details)
-----------------------------------            -----------------------------------
local inbox / outbox (messages)        <--->   provider message IDs, raw payloads
delivery state (pending/sent/...)      <--->   provider status callbacks
local call ledger                      <--->   provider call IDs/status callbacks
contacts & threads                     <--->   E.164 numbers on the wire
agent messages / approval requests     <--->   (none — local only)
attention policy                       <--->   (none — local only)
channel registry & capabilities        <--->   adapter implementations
```

Everything in the left column lives in ForgeLink's local SQLite store and the
main-process settings; nothing in the left column depends on a provider being
configured. The right column is reached only through a `ChannelAdapter`
(`backend/src/channels.ts`).

## Core model (today)

- **Messages** (`messages` table, `database.ts`): local-first inbox/outbox with
  stable local IDs, direction, body, media, delivery `status`, and the provider
  message ID stored *only* for reconciliation. Outbound rows persist as `pending`
  before any network call and survive restart.
- **Threads & contacts**: conversations and contact identity, resolved locally.
- **Agent messages / approvals** (`agent_messages`): agent-to-human requests with
  identity, intent, urgency, and an audit trail — created, displayed, and
  resolved entirely locally, with no telecom provider involved.
- **Attention policy**: notification routing rules, local only.
- **Calls**: provider-neutral call state, caller/callee identity, call lifecycle,
  local call ledger inputs, and disabled voice states are defined in
  [`voice-runtime.md`](voice-runtime.md). PSTN reachability always requires a
  telecom edge such as a provider, SIP trunk, carrier partnership, or direct
  interconnect.

## Channels are adapters

A `ChannelAdapter` exposes capability discovery, credential validation, outbound
`send`, and (where applicable) voice control plus inbound/status **normalization**
— so the core never touches provider-specific field names. The `ChannelRegistry`
selects an adapter by capability and rejects unsupported capabilities cleanly.

Adapter kinds:
- **native** — local desktop / agent delivery (no provider).
- **internet** — email, push, chat (future).
- **sms_mms_edge** — carrier SMS/MMS (Twilio and Telnyx shipped; Plivo and
  Bandwidth planned).
- **voice_edge** — PSTN voice call control and call-history reconciliation
  through a telecom edge.

## How existing SMS/MMS maps in

- **Outbound**: `POST /api/send`, retry, and approved outbound drafts build or
  reuse a local `pending` row, then select `sms_send` by the operator's explicit
  `twilio` or `telnyx` preference. The adapter returns a provider-neutral
  `SendResult`; the provider message ID and status are reconciled onto the row.
- **Twilio inbound/status**: `/webhooks/sms` and `/webhooks/status` validate the
  Twilio signature before normalization.
- **Telnyx inbound/status**: `/webhooks/telnyx` validates the exact raw body and a
  five-minute signed-timestamp freshness window, durably deduplicates by Telnyx
  event ID before acknowledgement, processes recognized messaging events in
  occurrence order, and feeds the same normalized local message/delivery contracts.
  Authentic unknown event types are recorded as unsupported rather than treated as
  generic status updates.

Provider wire fields remain implementation details behind each adapter, but the
providers are not interchangeable in the operator experience. The cockpit exposes
which edge is selected, whether that edge is ready, and the capabilities ForgeLink
actually implements. The durable message, approval, retry, and audit model remains
provider-neutral.

## Provider-specific operator contract

The shared contract stops at normalized communication behavior. Setup and capability
presentation stay provider-specific:

| ForgeLink edge | Setup model | Implemented capabilities | Inbound authenticity |
| --- | --- | --- | --- |
| Twilio | Account SID, Auth Token, SMS-capable number | SMS, MMS, Voice | Twilio request signatures and per-number webhooks |
| Telnyx | API v2 key, messaging number, messaging profile, Ed25519 public key | SMS, MMS | Messaging-profile webhook v2 and Ed25519 signatures |
| Local-only | No telecom credentials | local agent/human workflows | local authenticated runtime only |

First-run presents these as three distinct paths. The Channels overview, message
composer, new-message dialog, and reviewed outbox show the selected SMS/MMS edge.
ForgeLink does not imply that selecting Telnyx enables Voice; the current Voice edge
remains Twilio-specific.

## Local-only operation

With no telecom provider configured, the core still represents agent-to-human
messages and approval requests, contacts, threads, attention policy, and the
local inbox — the SMS/MMS edge is simply one capability that is absent from the
registry. First-run can continue local-only or open the provider-specific Twilio or
Telnyx flow. Provider setup also remains available later from Settings.
