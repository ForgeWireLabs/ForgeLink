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
- **sms_mms_edge** — carrier SMS/MMS (Twilio today; Telnyx/Plivo/Bandwidth later).
- **voice_edge** — PSTN voice call control and call-history reconciliation
  through a telecom edge.

## How existing SMS/MMS maps in

- **Outbound**: `POST /api/send` builds a local `pending` row, then
  `registry.select("sms_send").send({to, body, mediaUrls})`. The Twilio adapter
  delegates to the Twilio API and returns a provider-neutral `SendResult`; the
  provider message ID and status are reconciled back onto the local row.
- **Inbound**: `POST /webhooks/sms` is signature-validated, then the Twilio
  adapter's `parseInbound` normalizes the form payload into an `InboundMessage`
  that maps onto a local inbound `messages` row.
- **Delivery status**: `POST /webhooks/status` normalizes via `parseStatus` into a
  `DeliveryStatusUpdate` applied to the local row.

The provider is now an implementation detail behind the adapter; the durable
communication model is identical whether the transport is Twilio, a future
provider, a native local channel, or an agent message with no provider at all.

## Local-only operation

With no telecom provider configured, the core still represents agent-to-human
messages and approval requests, contacts, threads, attention policy, and the
local inbox — the SMS/MMS edge is simply one capability that is absent from the
registry. (Surfacing local-only mode in Settings/diagnostics and registering a
native local adapter is CLV-004.)
