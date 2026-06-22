# Provider conformance test kit (work item 015, CLV-021)

Every SMS/MMS and voice telecom edge adapter ForgeLink ships must clear one
shared bar instead of ad hoc per-provider tests. That bar is the conformance kit
in [`backend/src/channel-conformance.ts`](../Electron/backend/src/channel-conformance.ts).

The kit is exercised through the real adapters: each adapter's own test file
imports a runner and supplies provider-specific fixtures. No live provider calls
are made — senders, callers, and webhook payloads are deterministic stubs.

## Runners

- `runSmsEdgeConformance(spec)` — for `sms_mms_edge` adapters (Twilio, Telnyx, and
  any future SMS/MMS provider).
- `runVoiceEdgeConformance(spec)` — for `voice_edge` adapters (Twilio Voice today).

A spec wires the adapter to a controllable sender/caller and provides webhook
fixtures, a signature check, and a credential-clearing helper. See the existing
specs at the bottom of
[`twilio.test.ts`](../Electron/backend/src/twilio.test.ts) and
[`telnyx.test.ts`](../Electron/backend/src/telnyx.test.ts).

## What the kit asserts

| Case | SMS/MMS | Voice | How |
| --- | --- | --- | --- |
| Capability advertisement | ✓ | ✓ | adapter `capabilities()` / `supports()` |
| Send success → `SendResult` / `StartCallResult` | ✓ | ✓ | normalized provider id + status |
| Send / call rejection is redacted | ✓ | ✓ | error matches a body-free pattern |
| Inbound message / call normalization | ✓ | ✓ | `parseInbound` / `parseInboundCall` |
| Inbound MMS / media normalization | ✓ | — | media URLs + provider id |
| Delivery / call status normalization | ✓ | ✓ | `parseStatus` / `parseCallStatus` |
| **Duplicate inbound webhook is idempotent** | ✓ | — | normalized output run through a temp `PhoneDatabase` |
| **Backward / duplicate status transition rejected** | ✓ | ✓ | rank-gated `updateDeliveryStatus` / `applyCallStatus` |
| Invalid signature rejected, valid accepted | ✓ | ✓ | provider signature validator |
| Missing credentials reported | ✓ | ✓ | `validateCredentials().ok === false` |

The idempotency and backward-transition cases (bold) do not merely re-check the
parse functions — they drive each adapter's *normalized* output through a real
temporary SQLite `PhoneDatabase`, proving the end-to-end webhook path dedupes and
rejects stale status exactly as the live server does (`INSERT OR IGNORE` on the
provider message id; the status rank tables in `database.ts`).

## Adding a new provider

1. Implement the adapter behind the contracts in `channels.ts`.
2. In the adapter's test file, call `runSmsEdgeConformance` and/or
   `runVoiceEdgeConformance` with provider fixtures.
3. Build (`npm run backend:build`) and run the suite. A provider is not
   considered shippable until its conformance cases are green.

The delivery-status fixture should be a forward/terminal status (for example
`delivered`, or `in_progress`/`completed` for voice) so the backward-transition
case is meaningful against the database status ranking.
