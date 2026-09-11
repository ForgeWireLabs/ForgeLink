---
audience: operators, integrating agents, and maintainers
status: current
last_verified: 2026-09-10
source_of_truth: this document; work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase2-telnyx-fax-contract.md; work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase3-telnyx-fax-webhook-contract.md; work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase4-inbound-fax-acquisition-contract.md
---

# Telnyx Programmable Fax (work item 041, Phases 2–4)

Telnyx Programmable Fax is ForgeLink's first fax provider edge, implemented
as a distinct capability family from Telnyx SMS/MMS (`docs/telnyx.md`) —
even though the same Telnyx account may hold both. **This document covers
the outbound provider edge (Phase 2), the signed webhook ingress route
(Phase 3), and inbound fax reception with durable local document
acquisition (Phase 4).** The human Fax UI, MCP fax tools, the
communication firewall's fax draft flow, camera/device/cloud document
acquisition (FAX-009), and Tauri/mobile parity are later WI041 phases and
are not implemented yet — do not treat anything below as a shipped
human-facing feature. There is still no route or UI through which a human
can view or open a received fax; Phase 4 makes the document durably and
safely available on disk, associated with a local fax record, nothing more.

Current official Telnyx documentation was rechecked 2026-09-10; see
`local-artifacts/phase2-telnyx-fax-contract.md` (outbound send contract),
`local-artifacts/phase3-telnyx-fax-webhook-contract.md` (webhook event
allow-list, payload fields, ingress queue schema, and correlation contract),
and `local-artifacts/phase4-inbound-fax-acquisition-contract.md` (inbound
reception, document acquisition, managed storage, and the `GET`
media-refresh conclusion) for the full frozen contracts this integration
implements, with source URLs.

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

`TelnyxFaxProvider.validateCredentials()` — the check used to gate whether a
send should even be attempted — collapses this to a single `ok` boolean, and
`ok` is `true` only when `outbound_ready` is also `true`. A structurally
valid configuration (correct API key, a retrievable, active Fax Application,
a correctly assigned active phone number) that nonetheless has no Outbound
Voice Profile attached reports `ok: false` here, even though the same
configuration is truthfully reported as `configured: true` by the richer
readiness object above. Settings/status UI should use the richer
`configured`/`outbound_ready`/`inbound_webhook_ready` object; send-gating
code should use `validateCredentials()`.

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

### Provider-boundary document validation

Before a local file crosses into a Telnyx request, the production resolver
validates, in this order, all before any network call:

1. `local_ref` is a bare filename (no path traversal); the resolved real
   path must remain contained under the managed uploads directory (a
   `fs.realpath`-based check that also rejects a symlink/reparse point
   pointing outside it — one portable check, not a Windows-specific rule).
2. File size, checked via `fs.stat` *before* any full read, against
   Telnyx's documented 20MB multipart limit.
3. File format, via an extension allow-list (`.pdf`, `.tif`/`.tiff`,
   `.jpg`/`.jpeg`, `.png`, `.doc`, `.docx`, `.rtf`, `.txt`).
4. Content-type agreement: the extension's canonical content type is what
   is actually sent to Telnyx; a recorded `content_type` that disagrees at
   the top-level media type (e.g. `image/...` for a `.pdf` file) fails
   closed.
5. When `fax_documents.content_sha256` is non-empty, a SHA-256 check of the
   bytes actually read against that recorded hash — a document that changed
   after preparation is never silently sent as though it were the prepared
   one.

Every failure here is a `FaxProviderPreflightError`, never
`FaxProviderAmbiguousError` — none of it involved a network call.

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
is still in flight). A fax in `ambiguous` is never auto-resent by any
ForgeLink code path, including after an application restart.

Only an explicit, documented Telnyx rejection response becomes `failed`:
`400`, `401` (authentication failure — Telnyx never began processing an
unauthenticated request, so no fax could have been created), `403`, `404`,
`422`, and `429` (rate limited — likewise never processed). Automatic retry
remains prohibited regardless of this classification; a `429` may become an
operator-visible, retry-eligible failure later, never an automatic duplicate
send.

This classification only ever applies to the network call itself. Building
the request (resolving the document, constructing the JSON body or
`FormData`) is fully separated from invoking `fetch()`: a failure while
building the request — including every provider-boundary document check
above — is a `FaxProviderPreflightError`, because it provably happened
before any network attempt. Only a failure of `fetch()` itself (or an
unrecognized/malformed response) becomes `FaxProviderAmbiguousError`.
Persisting the opaque provider correlation token (below) is checked the
same way: if it cannot be durably established, the provider is never
called, and the fax is marked `failed`, not `ambiguous`.

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

## Cancellation — claim, provider outcome, and a known limitation

Telnyx documents cancellation as eligible only while a fax is `queued`,
`media.processed`, `originated`, or `sending` — ForgeLink's neutral
`accepted`/`sending` states, exactly the two states
`FaxSubmissionService.requestFaxCancellation`'s local claim already
requires.

`POST /v2/faxes/{id}/actions/cancel` returns `202` with
`{ "data": { "result": "ok" } }` — **no fax status is returned, and Telnyx's
own fax `status` enum has no `cancelled` value.** A `202` acknowledgment is
therefore proof only that Telnyx accepted the cancel *command*, never that
the fax is terminally cancelled.

`requestFaxCancellation` reconciles the local claim against what Telnyx
actually said:

- **No known provider fax id, or the configured provider has no `cancelFax`
  support** — the fax is never mutated into `cancel_pending` at all
  (`"unsupported"`). Cancellation was never attempted.
- **Telnyx explicitly accepts (`202`)** — the fax remains `cancel_pending`
  (`"claimed"`).
- **Telnyx's acceptance is unknown** (network error, timeout, 5xx,
  unrecognized response) — the fax remains `cancel_pending` (`"ambiguous"`):
  acceptance cannot be excluded, so it is not safe to assume the command was
  rejected.
- **Telnyx explicitly rejects** (`404` not found, `422` no longer eligible)
  — the local claim is rolled back to the fax's prior state
  (`"rejected"`) via a dedicated CAS restore scoped to
  `WHERE state = cancel_pending`, so a provider observation that has
  already raced the rejection and advanced the fax to a terminal state is
  never overwritten by the rollback.

The actual transmission outcome, once the command is accepted, is still
learned only from a later `GET`/observation — which, given Telnyx's status
enum, resolves as `delivered` (the cancellation lost the race) or `failed`
(Telnyx stopped the transmission), never a distinct `cancelled` state from
Telnyx's side. **FAX-005's cancel criterion is satisfied for correctly-
modeled, honest cancel *command* construction, an atomic non-duplicating
claim, and safe rollback on definite rejection — not for a terminal
Telnyx-confirmed cancellation, which no Telnyx API ForgeLink has inspected
currently proves.**

## Credential ownership

Telnyx Fax secrets (API key, webhook public key) are OS-encrypted via
Electron `safeStorage` in the main process (`Electron/telnyxFaxSettings.js`)
— never written to SQLite, never returned to the renderer, never placed in
RepoPact evidence. The backend receives decrypted values only through the
existing utility-process environment hand-off at launch, exactly like every
other ForgeLink provider credential.

## Webhook ingress (Phase 3)

`POST /webhooks/telnyx/fax` is a dedicated route, separate from the
existing SMS/MMS `/webhooks/telnyx` route: different signing key
(`TELNYX_FAX_PUBLIC_KEY`, never a fallback to the SMS/MMS
`TELNYX_PUBLIC_KEY`), different parsing/event-mapping module
(`telnyx-fax-webhook.ts`), and a different durable ingress table
(`telnyx_fax_webhook_events`, schema v32) distinct from both the SMS/MMS
ingress table and the provider-neutral `fax_events` ledger. It reuses only
the genuinely shared cryptographic primitive, `verifyTelnyxWebhook`
(Ed25519 over `${timestamp}|${rawBody}`, the existing five-minute
freshness window).

Processing order is fixed: bounded raw body → signature/timestamp headers
→ Ed25519 + freshness verification → JSON parse → bounded envelope
validation → durable enqueue → HTTP acknowledgement. An invalid signature,
a stale timestamp, or a malformed-but-authentic body are all rejected
before anything is enqueued; a database/enqueue failure returns a
non-success status so Telnyx retries. Only a successful durable enqueue —
new or an idempotent duplicate — is acknowledged; acknowledgement never
waits for the event to actually be applied to a fax.

Every supported `event_type` is classified as **outbound-only**
(`fax.queued`, `fax.media.processed`, `fax.sending.started`,
`fax.delivered`), **inbound-only** (`fax.receiving.started`,
`fax.media.processing.started`, `fax.received`), or **shared**
(`fax.failed` — the only event type Telnyx documents for both
directions). Routing is decided by comparing that classification against
the event's own signed, validated `direction` field, **never** by
inferring direction from the event type alone (Phase 3.1 correction: the
original implementation routed on event type alone, which meant an
authentic *inbound* `fax.failed` event incorrectly fell through into
outbound local-fax resolution instead of being deferred — fixed before
FAX-006 was re-satisfied). An event whose type's scope disagrees with its
own validated direction (e.g. an outbound-only type claiming inbound
direction) fails closed as a bounded `event_direction_mismatch` before any
local fax lookup is attempted in either direction.

**Outbound-routed events** (outbound-only types, or `fax.failed` with
`direction: "outbound"`) resolve to a local fax by direct `(provider,
provider_fax_id)` lookup, or by decoding a valid `client_state`
correlation token and binding the now-known provider fax id in the same
step. An event that cannot yet be resolved (e.g. it arrives before
`submitFax`'s own POST response has bound the provider fax id) stays
durably `"unresolved"` — eligible for reprocessing without a restart once
the binding occurs, and swept in full on startup (Phase 3.1: the sweep
now walks the entire unresolved backlog via a stable cursor rather than
only the first 100 rows), but never part of the immediate drain loop, so
an unresolved event can never spin. Every resolved observation is applied
through Phase 1.1's monotonic, direction-aware `applyFaxObservation`, so
out-of-order or duplicate delivery never regresses or double-applies
state; a resolved observation's bounded `failure_category` (for
`fax.failed`) and `page_count` (for events that carry one, such as
`fax.delivered`) now also reach the canonical fax record and the
provider-neutral `fax_events` ledger (Phase 3.1 correction: this
propagation was previously dropped at the handoff into the ledger).
`client_state` is treated as untrusted content even though the envelope
is signed: it must be canonical base64 and decode to ForgeLink's own
opaque correlation-token shape, or it is rejected without ever being
logged.

**Inbound-routed events** (inbound-only types, or `fax.failed` with
`direction: "inbound"`) are authenticated and durably enqueued by the
webhook route itself, then classified `"deferred_inbound"` by
`processTelnyxFaxWebhookEvent` (`telnyx-fax-webhook.ts`) with **no local
fax lookup, creation, or mutation performed by the webhook drain path
itself**. A separate, dedicated sweep introduced in Phase 4
(`fax-inbound.ts`, described below) is what actually consumes
`deferred_inbound` rows — this separation (webhook ingress vs. inbound
reception) is deliberate, not incidental, so that draining ordinary
webhook events can never trigger a network download by itself.

An authentic event whose `event_type` is outside the allow-list above is
durably classified `"unsupported"` and acknowledged — never guessed into
lifecycle state. See
`local-artifacts/phase3-telnyx-fax-webhook-contract.md` for the full event
table, payload fields, ingress queue schema, the deterministic race tests
proving both webhook-before-POST-response and
POST-response-before-webhook convergence, and its "Phase 3.1 correction
addendum" for the full detail of the corrections summarized above.

## Inbound fax reception and document acquisition (Phase 4)

Phase 4 turns authenticated `deferred_inbound` ingress rows into durable
local inbound fax records with safely-acquired local documents. It is
implemented as two deliberately separate stages so consuming
`deferred_inbound` rows never itself performs a network download:

1. **`fax-inbound.ts` (DB-only)** — for each `deferred_inbound` row,
   validates the event's `connection_id` against the configured Telnyx
   Fax Application (`TELNYX_FAX_CONNECTION_ID`); an authentic event for a
   *different* Fax Application in the same Telnyx account is classified
   `"foreign_connection"` with zero local fax lookup, never treated as a
   signature failure. For an owned event, `ensureInboundFax` atomically
   creates-or-resolves the local inbound fax by `(provider,
   provider_fax_id)` (never phone-number/timestamp heuristics), applies
   the transport observation (`receiving`/`processing`/`received`/`failed`)
   through the same monotonic `applyFaxObservation` outbound already uses,
   and — for `fax.received` — claims a document-acquisition authority.
   Out-of-order delivery converges correctly: `fax.received` arriving
   before any `receiving.started` event still creates exactly one fax and
   claims acquisition; a late, stale `receiving.started` after that never
   regresses it. A duplicate `fax.received` webhook never creates a second
   fax or a second acquisition claim.
2. **`fax-inbound-acquisition.ts` (the only place a network download
   happens)** — a separate, bounded, restart-safe worker
   (`fax_inbound_acquisitions`, keyed `(provider, provider_fax_id)` so at
   most one active acquisition exists per inbound fax) that resolves a
   download source (the fresh webhook `media_url` if unexpired, otherwise
   an authenticated `GET /v2/faxes/{id}` reconciliation — validated
   against the expected fax id/direction/connection before any URL from
   it is trusted), streams the response to a private managed-document
   store with a hard 20MB byte cap, and only commits content that begins
   with the PDF magic bytes. Everything else — oversized, zero-byte,
   non-PDF — is quarantined or discarded, **never** treated as a failure
   of the underlying fax transmission (see "Transport state vs. document
   acquisition state" in the Phase 4 contract). HTTP-level failures
   (expired signed URLs, 429/5xx, network errors) are bounded-retried with
   exponential backoff, up to 6 attempts, never resending the fax.

**Managed storage:** received documents live under
`<dataDir>/managed-documents/` — a private tree, structurally separate
from `<dataDir>/uploads/`, and **never reachable through the existing
public `/media/:filename` route** (proven directly in `server.test.ts`).
The durable local reference (`fax_documents.local_ref`) is always an
opaque store-generated id, never the provider's signed URL, never a raw
filesystem path.

**Credential separation:** the Telnyx API bearer token is attached only to
the `GET /v2/faxes/{id}` reconciliation call, never to the signed media
download, on any redirect hop — proven directly by inspecting the headers
an injected test transport actually receives.

**`GET` media-refresh conclusion (do not assume more than this):** current
Telnyx documentation does not state whether `GET /v2/faxes/{id}` returns a
refreshed media reference once the original webhook's ~10-minute signed
URL has expired. This phase never assumes it does — GET is a best-effort
recovery source only; if neither the webhook URL nor a GET-derived one is
usable, the acquisition truthfully reaches a `retryable` (and eventually
terminal `unavailable`) state rather than a fabricated success. See the
Phase 4 contract's dedicated section for the full reasoning.

Backup/restore now include `<dataDir>/managed-documents/` alongside the
existing `uploads/` tree (excluding in-flight staging files); an explicit
`deleteFaxDocument` primitive exists for removing one managed artifact
without disturbing any other. Full privacy/retention policy integration
remains FAX-013's own, separately-tracked criterion — this phase provides
necessary infrastructure for it, not its complete fulfillment. See the
Phase 4 contract artifact for the complete architecture, every validation
boundary, and the honestly-recorded residual limitations (notably: a
point-in-time-only SSRF host check, with no defense against DNS rebinding
between validation and connection).

## Current vs. future capability truth

Implemented in Phase 2: separate Telnyx Fax configuration and secure
storage, read-only readiness validation, the `TelnyxFaxProvider` adapter
(send/status-mapping/cancel/reconcile), and `FaxSubmissionService`'s
CAS-guarded outbound orchestration.

Implemented in Phase 3: the signed `/webhooks/telnyx/fax` ingress route,
durable event queueing with enqueue-before-ack semantics, outbound event
normalization and correlation, out-of-order/duplicate/restart-safe
reconciliation, and authenticated-but-deferred handling of inbound events.

Implemented in Phase 3.1 (correction, schema v32 → v33): explicit
event-type/direction compatibility routing (fixing an inbound `fax.failed`
event incorrectly reaching outbound resolution), failure-category/
page-count propagation into the canonical fax record and ledger, a bounded
expiry and startup cleanup for the transient inbound media URL, and a
multi-page restart-recovery sweep for the unresolved-event backlog.

Implemented in Phase 4 (schema v33 → v34): inbound local fax identity and
Fax Application ownership validation, transport-state-vs-document-
acquisition-state separation, a durable/restart-safe inbound document
acquisition worker (webhook-URL-first with authenticated `GET` fallback,
SSRF-bounded, size-bounded, PDF-validated, quarantine-capable), a private
managed-document store never reachable via the existing public media
route, and backup/restore/deletion integration for the resulting local
documents.

All of the above is exercised only through deterministic mocked
transport/signed-locally-generated-keypair fixtures in this repository's
test suite — no live Telnyx account has been contacted, and no real
inbound fax document has ever been downloaded from Telnyx.

Not implemented yet: the human Fax UI (FAX-008), camera/device/Google
Drive/OneDrive/SharePoint/Dropbox document acquisition (FAX-009, remains
under the binding document-acquisition scope amendment), MCP fax tools
(FAX-011), the communication-firewall fax draft/approval flow (FAX-010),
Tauri/mobile parity, full retention/privacy policy integration beyond the
deletion primitive introduced in Phase 4 (FAX-013), and the live Telnyx
acceptance gate (FAX-016). No fax has been sent through a live Telnyx
account by any ForgeLink code as of this document.
