---
audience: operators, integrating agents, and maintainers
status: current
last_verified: 2026-09-10
source_of_truth: this document; work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase2-telnyx-fax-contract.md
---

# Telnyx Programmable Fax (work item 041, Phase 2)

Telnyx Programmable Fax is ForgeLink's first fax provider edge, implemented
as a distinct capability family from Telnyx SMS/MMS (`docs/telnyx.md`) —
even though the same Telnyx account may hold both. **This document covers
the outbound provider edge only.** Inbound fax reception, the public fax
webhook route, the human Fax UI, MCP fax tools, and the communication
firewall's fax draft flow are later WI041 phases and are not implemented
yet — do not treat anything below as a shipped human-facing feature.

Current official Telnyx documentation was rechecked 2026-09-10; see
`local-artifacts/phase2-telnyx-fax-contract.md` for the full frozen contract
this integration implements, with source URLs.

## Fax Application vs. Messaging Profile

A Telnyx **Fax Application** (`connection_id`) is a distinct resource from a
Messaging Profile. It owns outbound/inbound fax routing, the Outbound Voice
Profile fax transmission actually requires, and the account-wide webhook
event URL for fax events. ForgeLink's Telnyx Fax configuration
(`TELNYX_FAX_API_KEY`, `TELNYX_FAX_CONNECTION_ID`, `TELNYX_FAX_PHONE_NUMBER`,
`TELNYX_FAX_PUBLIC_KEY`) is a separate configuration family from Telnyx
SMS/MMS's (`TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, ...) — a generic
`TELNYX_API_KEY` is never silently treated as fax configuration, and vice
versa, even though an operator may eventually enter the same underlying
Telnyx account credential for both.

A Fax Application's `id` is a plain string (Telnyx's own docs show a
numeric-looking example like `"1293384261075731499"`), **not a UUID**.
ForgeLink validates it as a bounded, non-empty, printable string.

## Outbound readiness

Read-only validation (`Electron/telnyxFaxSettings.js`'s
`validateTelnyxFaxSettings`, and the backend-side
`telnyx-fax.ts`'s `validateTelnyxFaxConfig`) never mutates a Telnyx
resource — it issues only `GET` requests, and separates three distinct
facts:

- **`configured`** — API key, Fax Application connection ID, and phone
  number are all present.
- **`outbound_ready`** — the Fax Application exists, is active, the
  configured phone number is active and assigned to that Fax Application,
  **and the Fax Application has an Outbound Voice Profile attached**
  (`outbound.outbound_voice_profile_id`). A retrievable, active Fax
  Application is *not* by itself proof outbound fax will work — Telnyx
  requires the Outbound Voice Profile, and validation checks for it
  explicitly.
- **`inbound_webhook_ready`** — a webhook public key is configured locally
  *and* the Fax Application has a webhook event URL configured. This is
  readiness bookkeeping only; Phase 2 does not implement the actual inbound
  webhook route (Phase 3).

There is no Telnyx API field that directly proves "this number is
fax-capable" the way SMS exposes `features.sms` — assignment to a Fax
Application connection is the strongest signal Telnyx's API exposes, and is
what ForgeLink checks.

## `command_id` is not part of the send-fax contract

Telnyx's prose "Sending Commands" documentation mentions a `command_id`
parameter with 60-second duplicate suppression, but the current `POST
/v2/faxes` request schemas (JSON and multipart) do not include a
`command_id` property. ForgeLink does not send one. ForgeLink's own
`local_fax_id` and the atomic `submission_pending -> submitting` claim
(`Electron/backend/src/fax-submission.ts`) remain the sole durable
idempotency authority for outbound fax; Telnyx-side deduplication, even if
it existed here, would only ever be a secondary, short-lived protection.

## Media / document mode

No public URL-serving mechanism exists in ForgeLink, and this phase does not
add one. `media_name` requires media already uploaded to Telnyx's Media
Storage, which ForgeLink does not integrate with. ForgeLink therefore sends
a locally-managed fax document via Telnyx's `multipart/form-data` `contents`
upload (max 20MB; PDF/TIFF/JPEG/PNG/DOC/DOCX/RTF/TXT), reading the file from
the same `<dataDir>/uploads/` directory the existing MMS media path already
uses. `media_url` is also implemented in the adapter (for a future case
where a document is reachable via an authenticated URL) and is what
deterministic tests use by default, since it needs no local file I/O.

**Known limitation:** Telnyx's multipart `contents` schema has no
`client_state` field, so a fax sent via the local-file resolver cannot carry
ForgeLink's opaque provider correlation token (below). If such a send also
lands in `ambiguous` without ever capturing a provider fax ID, ForgeLink
cannot resolve it via a webhook `client_state` match in Phase 3 and must
rely on other reconciliation (a later `GET` once a provider fax ID becomes
known some other way) or operator judgment. This is a real, recorded
production gap for that narrow case — not a blocking defect.

## Provider status normalization

ForgeLink never exposes Telnyx's own status strings outside
`telnyx-fax.ts`. The frozen mapping (see the local-artifacts contract
document for the full authoritative `status` enum and reasoning):

```text
outbound: queued/media.processed -> accepted
          originated/sending     -> sending
          delivered              -> delivered
          failed                 -> failed

inbound:  initiated/receiving       -> receiving
          media.processing         -> processing
          received                 -> received
          failed                   -> failed
```

Any other status string is treated as unknown: the observation is not
applied (no state mutation), which is safe because ForgeLink's normalized
lifecycle (`Electron/backend/src/fax.ts`) never lets an unrecognized
observation regress or corrupt local state.

## Ambiguous-send semantics

Sending a fax is a high-consequence external side effect. ForgeLink never
automatically retries the outbound `POST` after a network timeout,
connection reset, 5xx response, malformed "successful" response, or any
other response it cannot classify as a definite rejection. All of those
land the fax in the `ambiguous` local state (never `failed`, which would
look safe to retry, and never left `submitting`, which would look like it
is still in flight). Only an explicit, documented Telnyx rejection response
(a recognized 4xx) becomes `failed`. A fax in `ambiguous` is never
auto-resent by any ForgeLink code path, including after an application
restart.

## Reconciliation

`GET /v2/faxes/{id}` (`FaxSubmissionService.reconcileFax`) is available once
a provider fax ID is known. Every observation is fed through Phase 1.1's
`applyFaxObservation` — monotonic, direction-aware, skip-ahead-safe — never
the strict local-command path, so a stale or out-of-order `GET` can never
regress state, and an observation whose provider-reported direction
disagrees with the local fax's own direction is safely refused rather than
applied. If the provider fax ID is unknown (the send never got far enough to
capture one), reconciliation cannot resolve the fax by any other heuristic —
ForgeLink deliberately does not match on recipient, sender, timestamp, page
count, or filename to "probably" identify the same transmission, because
that is not safe enough to resolve duplicate-send ambiguity.

## Cancellation — known limitation

`POST /v2/faxes/{id}/actions/cancel` returns `202` with
`{ "data": { "result": "ok" } }` — **no fax status is returned, and Telnyx's
own fax `status` enum has no `cancelled` value.** A `202` acknowledgment is
therefore proof only that Telnyx accepted the cancel *command*, never that
the fax is terminally cancelled. ForgeLink enters the local `cancel_pending`
state on a successful cancel command and leaves the actual outcome to a
later `GET`/observation — which, given Telnyx's status enum, will resolve as
`delivered` (the cancellation lost the race) or `failed` (Telnyx stopped the
transmission), not as a distinct `cancelled` state from Telnyx's side.
**FAX-005's cancel criterion is satisfied for correctly-modeled, honest
request construction and local nonterminal state — not for a terminal
Telnyx-confirmed cancellation, which no Telnyx API ForgeLink has inspected
currently proves.**

## Credential ownership

Telnyx Fax secrets (API key, webhook public key) are OS-encrypted via
Electron `safeStorage` in the main process (`Electron/telnyxFaxSettings.js`)
— never written to SQLite, never returned to the renderer, never placed in
RepoPact evidence. The backend receives decrypted values only through the
existing utility-process environment hand-off at launch, exactly like every
other ForgeLink provider credential.

## Current vs. future capability truth

Implemented in Phase 2: separate Telnyx Fax configuration and secure
storage, read-only readiness validation, the `TelnyxFaxProvider` adapter
(send/status-mapping/cancel/reconcile), and `FaxSubmissionService`'s
CAS-guarded outbound orchestration — all exercised only through deterministic
mocked transport in this repository's test suite.

Not implemented yet: the public fax webhook route and inbound reception
(Phase 3), the human Fax UI (Phase 5), MCP fax tools (Phase 6), the
communication-firewall fax draft/approval flow (Phase 6), Tauri/mobile
parity (Phase 7), and the live Telnyx acceptance gate (FAX-016). No fax has
been sent through a live Telnyx account by any ForgeLink code as of this
document.
