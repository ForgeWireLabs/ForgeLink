# Twilio telecom edge provider

Twilio is a ForgeLink telecom edge adapter. ForgeLink owns local message and call
state; Twilio carries SMS/MMS packets and PSTN call-control requests.

## Configure

Twilio uses the existing environment-backed credential path:

```powershell
$env:TWILIO_ACCOUNT_SID = "AC..."
$env:TWILIO_AUTH_TOKEN = "..."
$env:TWILIO_PHONE_NUMBER = "+15551234567"
$env:TWILIO_PUBLIC_BASE_URL = "https://your-public-tunnel.example"
```

`TWILIO_PUBLIC_BASE_URL` is required for webhooks, media upload URLs, SMS/MMS
status callbacks, and Voice call callbacks.

## SMS/MMS

Outbound SMS/MMS goes through the provider-neutral `sms_send`/`mms_send`
capabilities. Inbound SMS/MMS posts to:

```text
https://your-public-tunnel.example/webhooks/sms
```

Delivery status posts to:

```text
https://your-public-tunnel.example/webhooks/status
```

ForgeLink validates `X-Twilio-Signature` against the configured public base URL
before processing either webhook.

## Voice

Twilio Voice is registered as a `voice_edge` adapter with provider-neutral
capabilities:

- `voice_call`
- `voice_start`
- `voice_end`
- `voice_status`
- `inbound_call`

Local call rows are created before the provider request. Twilio call SIDs are
stored only as reconciliation fields on the local call row.

Local API:

```text
POST /api/calls/start
POST /api/calls/end
GET  /api/calls
```

Twilio callbacks:

```text
POST /webhooks/voice/twiml
POST /webhooks/voice/status
```

`/webhooks/voice/status` is signature-validated and idempotent. Duplicate,
backward, or late-failing status callbacks do not regress completed local call
rows. Inbound Twilio call callbacks create inbound local call rows when ForgeLink
has not seen the provider call SID before.

`/webhooks/voice/twiml` returns minimal TwiML to keep the provider call alive for
call-control testing. ForgeLink does not yet ship a media bridge, browser soft
phone, call recording, transcription, voicemail, emergency calling, CNAM,
STIR/SHAKEN management, or E911 behavior. Those require separate criteria and
evidence before the UI may present them as available.

## Error handling

Provider failures are redacted. ForgeLink records short actionable summaries such
as `Twilio rejected the call (500).` and never stores provider response bodies,
credentials, account IDs, real call audio, or recordings in diagnostics.
