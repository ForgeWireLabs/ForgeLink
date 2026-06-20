# Telnyx SMS/MMS provider (work item 015, CLV-007)

Telnyx is ForgeLink's second SMS/MMS telecom edge, behind the same provider-neutral
channel contract as Twilio (`backend/src/channels.ts`). Configuring Telnyx does
not change or break the Twilio path; the channel registry simply gains another
`sms_mms_edge` adapter.

## Configure

Telnyx is configured through environment variables (the in-app credential form is
folded into the operator cockpit, 017):

```powershell
$env:TELNYX_API_KEY = "KEY..."                 # Telnyx API v2 key (Bearer)
$env:TELNYX_PHONE_NUMBER = "+15551234567"      # an SMS-capable Telnyx number
$env:TELNYX_PUBLIC_KEY = "base64-ed25519-key"  # the portal's webhook public key
$env:TELNYX_MESSAGING_PROFILE_ID = "..."       # optional
```

When `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER` are present, the Telnyx adapter is
registered and appears in `/api/diagnostics` `channels`.

## Webhook

Point the Telnyx messaging profile's webhook at:

```text
https://your-public-tunnel.example/webhooks/telnyx
```

Telnyx posts JSON events signed with **Ed25519**. ForgeLink verifies
`${telnyx-timestamp}|${rawBody}` against `TELNYX_PUBLIC_KEY` before processing;
invalid or missing signatures are rejected with `403`.

- `message.received` events are normalized into the local inbox (SMS and MMS;
  media URLs are carried through).
- Status events (`message.sent` / `message.finalized` / ...) update the local
  delivery state. Duplicate inbound webhooks are idempotent (keyed on the Telnyx
  message ID); backward/duplicate status transitions are ignored by the local
  store, the same as Twilio.

## Send

Outbound goes through `POST https://api.telnyx.com/v2/messages` with a Bearer
token and a JSON body (`from`, `to`, `text`, optional `media_urls`,
`messaging_profile_id`). The provider message ID and status are reconciled onto
the local message row; provider error bodies are never surfaced.

## Capabilities

`sms_send`, `mms_send`, `inbound_sms`, `delivery_status`, `media`. Voice is not
provided by this adapter.
