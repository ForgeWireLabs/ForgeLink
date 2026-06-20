# ForgeLink voice runtime and telecom edge contract

ForgeLink owns local call state. Telecom providers, SIP trunks, carriers, and
future direct interconnects are edge adapters that can place or receive PSTN
calls, but they do not define the ForgeLink data model.

## Boundary

```text
ForgeLink-owned call state                  Telecom edge state
--------------------------                  ------------------
local call ID                       <--->   provider call ID
contact/contact-point resolution    <--->   caller/callee phone numbers
direction and lifecycle status      <--->   provider call callbacks
call log rows and retention         <--->   provider records
redacted error summary              <--->   provider error payloads
disabled/unavailable state          <--->   missing credentials or capability
```

ForgeLink can represent calls locally when no voice provider is configured. It
cannot reach the public switched telephone network without a telecom edge such
as a provider, SIP trunk, carrier partnership, or direct interconnect.

## Provider-neutral contract

The channel contract in `Electron/backend/src/channels.ts` defines the voice
surface every voice edge adapter must map onto:

- Capability discovery: `voice_call`, `voice_start`, `voice_end`,
  `voice_status`, and `inbound_call`.
- Disabled state: `VoiceAvailability` reports whether voice is available and
  why it is unavailable (`not_configured`, `missing_credentials`,
  `unsupported_provider`, or `provider_unavailable`).
- Outbound control: `OutboundCallRequest` carries the local call ID,
  caller/callee identity, and optional contact/contact-point resolution; the
  adapter returns `StartCallResult`.
- Inbound calls: provider webhooks normalize into `InboundCallEvent`, including
  caller, callee, local direction, status, and occurrence time.
- Status callbacks: provider status callbacks normalize into
  `CallStatusUpdate`, including status, timestamps, duration, and any redacted
  error summary.
- Call end: `endCall` returns an `EndCallResult` so the local runtime can
  reconcile the provider call ID and final status.
- Persistence input: `CallRecordInput` is the provider-neutral shape for future
  durable local call rows.

Provider adapters may keep raw payload details only in redacted or test-only
diagnostic shapes. Renderer-facing and support-diagnostic errors use
`ProviderError` or `CallStatusUpdate.redactedError`; they must not include
credentials, provider response bodies, call audio, recordings, personal contact
details, or real phone numbers.

## Local call lifecycle

The local runtime will create a durable call row before calling the provider,
using a ForgeLink local call ID as the stable primary reference. Provider call
IDs are reconciliation fields, not primary local identity.

Expected statuses are:

- `queued`
- `ringing`
- `in_progress`
- `completed`
- `failed`
- `busy`
- `no_answer`
- `canceled`

Status updates must be idempotent. Duplicate or older provider callbacks should
not regress the local call row once the implementation lands in later CLV-013
and CLV-016 slices.

## Scope

This voice slice covers call control and call history first:

- outbound call start/end;
- inbound call event normalization;
- status callback normalization;
- local call ledger inputs;
- contact/contact-point identity mapping;
- disabled/unavailable states;
- redacted provider errors.

Call recording, transcription, audio streaming, voicemail, emergency calling,
caller ID reputation, CNAM, STIR/SHAKEN, and E911 behavior are separate explicit
decisions. The UI must not imply those features are shipped until their own
criteria and evidence exist.
