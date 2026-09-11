# WI041 Phase 3 — frozen Telnyx Fax webhook ingress contract

Verified 2026-09-10 against:

- `https://developers.telnyx.com/docs/programmable-fax/sending-commands` —
  outbound fax webhook events (`fax.queued`, `fax.media.processed`,
  `fax.sending.started`, `fax.delivered`, `fax.failed`).
- `https://developers.telnyx.com/docs/programmable-fax/receive-a-fax-api` —
  inbound fax webhook events (`fax.receiving.started`,
  `fax.media.processing.started`, `fax.received`, `fax.failed`) and their
  payload fields.
- `https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json`
  (`team-telnyx/openapi`) — the same primary OpenAPI source Phase 2's
  contract (`phase2-telnyx-fax-contract.md`) used for the `Fax` resource
  schema, `failure_reason` allow-list, and account-wide Ed25519 webhook
  signing mechanism; too large (6.7MB) for full automated retrieval in one
  pass, so the developer-docs pages above are the primary source for the
  event-type/payload details specific to this phase, cross-checked against
  the `Fax` resource fields Phase 2 already extracted from the spec.

This is the contract `telnyx-fax-webhook.ts` and the `/webhooks/telnyx/fax`
route in `server.ts` implement. Do not extend it without re-verifying
against the live docs/spec.

**Phase 3.1 correction notice (2026-09-10, schema v32 → v33):** this
document's original prose already stated the correct intent for
`fax.failed` routing ("the webhook envelope's own `direction` field...is
what this module...use[s] to route it" — see below), but Phase 3's actual
implementation did not enforce that: `processTelnyxFaxWebhookEvent` routed
on `isTelnyxFaxInboundEventType(event_type)` alone, which never listed
`fax.failed` (correctly — it is not inbound-*only*), so an authentic
inbound `fax.failed` event fell through into outbound local-fax
resolution instead of the deferred_inbound path. See "Phase 3.1 correction
addendum" at the end of this document for the full fix (event-type/
direction compatibility, failure-category/page-count propagation,
transient-media expiry, and multi-page restart sweep). The tables/sections
above and below are otherwise still accurate as written; only the
sections explicitly marked "(Phase 3.1)" changed.

## Event allow-list (frozen)

| `event_type` | Fires when | Direction | Maps to |
|---|---|---|---|
| `fax.queued` | Send request accepted by Telnyx | outbound | `accepted` |
| `fax.media.processed` | The PDF file has been processed | outbound | `accepted` |
| `fax.sending.started` | Transmission begins | outbound | `sending` |
| `fax.delivered` | Fax delivered successfully | outbound | `delivered` |
| `fax.failed` | Transmission failed (either direction) | outbound or inbound | `failed` |
| `fax.receiving.started` | Fax has begun transmitting to Telnyx | inbound | `receiving` (Phase 4; deferred in Phase 3) |
| `fax.media.processing.started` | Telnyx is generating the digital PDF | inbound | `processing` (Phase 4; deferred in Phase 3) |
| `fax.received` | The PDF has been generated and is downloadable | inbound | `received` (Phase 4; deferred in Phase 3) |

`fax.failed` is the one event type documented for both directions; the
webhook envelope's own `direction` field (never event-type inference)
is what this module and the ingress row use to route it. Any `event_type`
outside this table is authentic-but-unsupported and is durably classified
as `"unsupported"` and acknowledged — never guessed into lifecycle state,
and never silently dropped.

Discovered but not required by this phase: `fax.received`'s documented
payload includes `call_duration_secs` and `partial_content` fields specific
to inbound reception; Phase 3 does not read them since inbound events are
uniformly deferred (see "Inbound deferral boundary" below).

## Payload fields consumed (bounded, per event)

From the developer docs above, the fields Telnyx documents on these events
are a superset of what ForgeLink actually reads. `telnyx-fax-webhook.ts`'s
`parseTelnyxFaxWebhookEnvelope` extracts only:

- `data.id` (event id, ≤120 chars) — ingress dedup key.
- `data.event_type` (≤80 chars) — the allow-list discriminator.
- `data.occurred_at` — must parse as a valid date; used for ordering
  (never HTTP arrival order).
- `data.payload.fax_id` (falls back to `data.payload.id`, ≤120 chars) —
  the provider fax id; required, or the envelope is rejected as malformed.
- `data.payload.direction` (`"outbound"` / `"inbound"` only) — preserved as
  `null` when missing or any other value, **never defaulted to outbound**
  (Phase 2.1's rule applies identically here).
- `data.payload.client_state` (≤512 chars, canonical base64) — see
  correlation below.
- `data.payload.page_count` (bounded integer, 0–100,000) — out-of-range or
  non-integer values are dropped (`null`), never clamped or trusted as-is.
- `data.payload.failure_reason` — mapped through the same customer-safe
  allow-list Phase 2 already extracted from the `Fax` resource schema
  (`safeTelnyxFaxFailureCategory`); anything outside the allow-list
  (including a genuinely new future Telnyx value) becomes the generic
  `"unknown"` category. `internal_failure_reason` is never read anywhere
  in this module.
- `data.payload.media_url` (≤2048 chars) — captured only as a bounded
  *transient* field on the ingress row, never as a durable
  `FaxDocumentRef`. Per the `fax.received` documentation above, Telnyx's
  `media_url` for inbound reception is **a signed AWS link valid for only
  10 minutes** — this confirms the mission's "short-lived/recovery policy"
  requirement is not a defensive guess but a documented constraint; Phase 4
  (inbound document acquisition) must download it well within that window
  or treat it as expired and fall back to `GET /v2/faxes/{id}` for a fresh
  reference. Phase 3 does not attempt any download.
- `meta.attempt` (bounded integer, 0–100) and `meta.delivered_to` (≤2048
  chars, hashed before storage) — retry/delivery metadata, mirrored from
  the existing SMS/MMS webhook envelope handling in `telnyx.ts`.

## Signature and freshness contract

Reuses the existing hardened `verifyTelnyxWebhook` primitive unchanged
(Ed25519 over `${timestamp}|${rawBody}`, the same account-wide signing key
mechanism Phase 2's contract documented) with the existing five-minute
timestamp-freshness posture. The only change is the public key: the fax
route reads `loadTelnyxFaxConfig().publicKey` (`TELNYX_FAX_PUBLIC_KEY`),
**never** `process.env.TELNYX_PUBLIC_KEY` (the SMS/MMS key) even as a
fallback — verified by a dedicated test that signs a fax event with a
different keypair and confirms rejection.

Exact processing order (never reordered): bounded raw body (64KB cap,
matching the existing SMS/MMS route and `readJson`'s general limit) → read
`telnyx-timestamp`/`telnyx-signature-ed25519` headers → Ed25519 + freshness
verification → JSON parse → bounded envelope validation
(`parseTelnyxFaxWebhookEnvelope`) → durable enqueue
(`enqueueTelnyxFaxWebhookEvent`) → HTTP acknowledgement. An invalid
signature, a stale timestamp, or a malformed-but-authentic body all fail
closed before any enqueue attempt; a database/enqueue failure returns a
non-success HTTP status so Telnyx retries, rather than acknowledging a
newly durable event that in fact never queued.

## Ingress queue schema (`telnyx_fax_webhook_events`, schema v32; `transient_media_expires_at` added in v33, Phase 3.1)

Provider-specific and distinct from the provider-neutral `fax_events`
ledger (Phase 1's normalized observation table). Stores only the bounded
extracted fields above, never a raw payload — no
`payload_json`/`payload_raw` column exists on this table, unlike the SMS
ingress table's retained (bounded-lifetime) payload. Deduplicates on
`event_id` via `INSERT OR IGNORE`.

`processing_status` values and their drain eligibility:

| Status | Meaning | Drained by |
|---|---|---|
| `pending` | Newly enqueued, not yet attempted | the immediate/recurring `setImmediate` drain loop |
| `unresolved` | Authentic outbound event, no local fax could be resolved yet | (a) the startup sweep (Phase 3.1: `unresolvedTelnyxFaxWebhookEventsPage`'s rowid-cursor pagination visits the *entire* backlog in one pass, not just the first 100 rows), (b) the explicit post-binding re-trigger — **never** the immediate drain loop, so this can never hot-loop |
| `deferred_inbound` | Authentic inbound event, intentionally not processed further in Phase 3 | nothing (terminal for this phase; Phase 4's own future consumer) |
| `unsupported` | Authentic event, `event_type` not in the allow-list | nothing (terminal) |
| `resolved` | Applied to a local fax via the normalized ledger | nothing (terminal) |
| `failed` | Processing itself failed (event/direction mismatch, invalid direction, local direction mismatch, internal error) | nothing (terminal) |

`transient_media_url` (Phase 3, inbound `media_url` only) now pairs with
`transient_media_expires_at` (Phase 3.1) — see "Transient media URL
expiry and cleanup (Phase 3.1)" below.

## Local fax resolution order (frozen, never heuristic)

**Phase 3.1: a pre-resolution event-type/direction compatibility gate now
runs before any of the following.** Every supported `event_type` is
classified as outbound-only, inbound-only, or shared (`fax.failed` is the
only shared type) via `telnyxFaxEventDirectionScope`; if that scope
disagrees with the row's own validated `direction` (e.g. an outbound-only
type claiming inbound direction), the event fails closed as
`event_direction_mismatch` and **no local fax lookup is attempted at
all** — not resolution, not the local direction check in step 2 below. If
the scope is inbound-only, or is shared *and* the row's direction is
inbound, the event is classified `deferred_inbound` with equally zero
local fax lookup. Only an outbound-only event, or a shared event whose
direction is outbound, reaches the resolution steps below:

1. Direct `(provider, provider_fax_id)` lookup via `faxByProviderFaxId`.
2. If unresolved and a valid `client_state` correlation token decodes and
   matches a fax by `faxByProviderCorrelationToken`, bind the provider and
   provider fax id now that both are known (`bindFaxProvider` +
   `bindFaxProviderIdentity`) and resolve to that fax.
3. Otherwise the event remains `"unresolved"` — **never** matched by
   recipient/sender/timestamp/page-count/filename/document hash. A
   multipart (`contents`-mode) send genuinely cannot carry `client_state`
   (Phase 2's frozen contract), so such an ambiguous send's webhooks can
   only resolve via step 1 once a provider fax id becomes known by some
   other means (e.g. a later `GET` reconciliation) — this is the same
   documented, accepted gap Phase 2 recorded, not a new one.

`client_state` is treated as untrusted despite the signed envelope: it must
be canonical base64, ≤512 chars, and decode to a string matching
ForgeLink's own opaque correlation-token shape
(`generateProviderCorrelationToken`'s `base64url`, 16–64 chars). Any other
decoded content is rejected and never logged, including on the invalid
path — this is verified by a dedicated test that submits a decodable-but-
not-a-token string (and a decodable phone-number-shaped string) and
confirms rejection without a crash or a resolved fax.

## Provider identity binding and the POST-response/webhook race

`bindFaxProvider`/`bindFaxProviderIdentity` (Phase 3 prerequisite,
`database.ts`) are independent, write-once primitives, deliberately
decoupled from `applyFaxState`/`applyFaxObservation`'s lifecycle CAS:

- `submitFax` binds the fax to the invoking provider *before* calling it —
  an already-differently-bound fax fails closed (`provider_mismatch`) with
  no provider call at all.
- After a successful send, `submitFax` binds the provider fax id
  independently of whatever lifecycle state a racing webhook may have
  already advanced the fax to, so the provider identity itself can never be
  lost to that race. A conflicting identity (the exact provider fax id
  already bound to a *different* local fax) resolves to `"ambiguous"`
  (`provider_identity_conflict`) rather than silently overwriting either
  fax's binding — the `(provider, provider_fax_id)` unique index remains
  the final authority even if the row-level pre-check somehow missed a
  concurrent conflict.
- `submitFax` accepts an optional `onProviderFaxIdBound(provider,
  providerFaxId)` hook, invoked immediately after a successful bind.
  `server.ts` (once outbound fax submission is wired to an HTTP route —
  Phase 3 implements the hook contract and the ingress-side query it
  depends on; the outbound submission API route itself remains a Phase 4+
  concern) would use this to call
  `unresolvedTelnyxFaxWebhookEventsByProviderFaxId(providerFaxId)` and
  reprocess any event that had arrived and gone `"unresolved"` before the
  binding existed — resolving the "webhook arrived before the POST
  response" race without waiting for a restart. Both race orderings are
  proven deterministically in `fax-submission.test.ts`:
  - *webhook-first*: the event enqueues and processes to `"unresolved"`
    before `submitFax` runs; the hook firing during `submitFax` reprocesses
    it immediately, converging to the webhook's own (possibly more
    advanced, e.g. `delivered`) observation.
  - *POST-first*: `submitFax` completes and binds the identity first; the
    webhook then resolves directly via the ordinary direct-lookup path with
    no special-casing needed.
  - A third test proves the *fallback* path: without the hook wired (e.g.
    an app restart between the webhook arriving and the identity binding),
    the event correctly stays `"unresolved"` until the startup recovery
    sweep (`unresolvedTelnyxFaxWebhookEvents()`) reprocesses it — it is
    never lost.

## Out-of-order and duplicate handling

Every resolved event is applied through `applyFaxObservation` (Phase 1.1's
monotonic, skip-ahead-safe, direction-scoped reconciliation), never the
strict local-command path — arrival order at the HTTP route is never
trusted as lifecycle order. An older event arriving after a newer one has
already advanced the fax is still durably recorded (`"resolved"` in the
ingress queue, and the ledger row exists in `fax_events`) but does not
mutate state (Phase 3 test: "an out-of-order (earlier) event never
regresses a later authoritative state"). Two concurrent forward
observations (e.g. one worker sees `sending`, another sees `delivered`) both
converge correctly to the later authoritative state; neither is lost — this
is proven directly against `applyFaxObservation`'s now-richer
`FaxObservationOutcome` return type
(`"advanced"`/`"duplicate"`/`"stale"`/`"illegal"`) in `database.test.ts`,
and end-to-end through two webhook rows in `telnyx-fax-webhook.test.ts`.
Ingress-queue dedup (`event_id`, `INSERT OR IGNORE`) and ledger dedup
(`(provider, event_id)` in `fax_events`) are separate, independently-tested
defenses; both are idempotent.

## Inbound deferral boundary (Phase 3/Phase 4)

Every inbound-only event type (`fax.receiving.started`,
`fax.media.processing.started`, `fax.received`), **and the shared
`fax.failed` type whenever the row's own validated direction is
`inbound`** (Phase 3.1 correction — see the correction notice above),
is authenticated, durably enqueued, and classified `"deferred_inbound"`
with **zero local fax lookup, creation, or mutation attempted** — Phase 3
does not implement inbound reception (FAX-007 remains pending). This
status is deliberately excluded from every drain trigger so it can never
be mistaken for a failed or stuck restart-recovery item; Phase 4 is
expected to consume these authenticated, bounded records as its own
starting point rather than re-authenticating raw payloads. Proven by a
dedicated test that sends an inbound `fax.failed` event whose
`provider_fax_id` deliberately matches an existing *outbound* fax's own
binding, confirming that fax is never touched.

## Redaction and bounded retention

No raw webhook payload is ever persisted for fax (unlike the SMS/MMS
ingress table's bounded-lifetime `payload_json`) — only the extracted
bounded fields above. `internal_failure_reason` is never read, and never
appears in `faxes.failure_category`, `fax_events.failure_category`, or
this table's `failure_category`/`bounded_error` columns (Phase 3.1 added
explicit propagation tests for this). `bounded_error` on a `"failed"` row
is one of a small fixed set of internal category strings
(`invalid_direction`, `event_direction_mismatch` (Phase 3.1),
`direction_mismatch`, `processing_failed`), never a raw exception message
or provider text. `delivery_target_hash`
stores a SHA-256 of the webhook delivery URL, never the URL itself (which
may embed a query-string secret), mirroring the existing SMS/MMS handling.

## Known limitation carried forward

Because `contents`-mode (multipart) outbound sends cannot carry
`client_state` (Phase 2's frozen contract), a webhook for such a send can
only resolve via direct `(provider, provider_fax_id)` lookup — if that send
was also `ambiguous` (network/timeout uncertainty during the POST) with no
provider fax id ever captured, its webhooks remain unresolved until some
other means establishes the provider fax id (a `GET` reconciliation, or
operator judgment). This is unchanged from Phase 2 and not a new gap
introduced by this phase.

## Phase 3.1 correction addendum (2026-09-10, schema v32 → v33)

Following a review of the actual Phase 3 implementation (not merely this
document), five issues were found and corrected. FAX-006 was reopened for
this review and is re-satisfied by this correction together with the
original Phase 3 evidence (both retained; see the WI041 progress log).

### Finding 1 — event-type/direction routing, not event-type-alone routing

**Bug:** `isTelnyxFaxInboundEventType()` never listed `fax.failed`
(correctly — it is genuinely not inbound-*only*), but
`processTelnyxFaxWebhookEvent()` branched its inbound-vs-outbound routing
decision on that same set alone. So an authentic inbound `fax.failed`
event (`event_type: "fax.failed"`, `direction: "inbound"`) fell through
into outbound local-fax resolution instead of the `deferred_inbound` path
this document already (correctly) described as the intended behavior.

**Fix:** `telnyx-fax-webhook.ts` now classifies every supported event type
into one of three scopes via `telnyxFaxEventDirectionScope(eventType)`:

```text
outbound-only : fax.queued, fax.media.processed, fax.sending.started, fax.delivered
inbound-only  : fax.receiving.started, fax.media.processing.started, fax.received
shared        : fax.failed
```

`isTelnyxFaxEventDirectionCompatible(eventType, direction)` returns true
only when the scope is `"shared"` or equals the validated `direction`.
`processTelnyxFaxWebhookEvent` now checks this *before* any inbound/
outbound branching or local fax resolution: an incompatible pairing (e.g.
`fax.delivered` + `direction: "inbound"`, or `fax.receiving.started` +
`direction: "outbound"`) fails closed as `bounded_error:
"event_direction_mismatch"` with **zero local fax lookup attempted in
either direction** — never guessed into either lifecycle. Only after that
gate passes does the inbound-vs-outbound decision run: inbound-only, or
shared-and-inbound, routes to `deferred_inbound`; outbound-only, or
shared-and-outbound, routes to the existing resolution/ledger path. The
local `direction_mismatch` guard (comparing a *resolved* local fax's own
direction against the row's direction) is retained unchanged for the
genuinely distinct failure mode it protects against — a stale/incorrect
provider identity binding pointing at a local fax of the wrong direction
— and is now exercised by a replacement test using an outbound-routable
event type instead of the no-longer-representative inbound `fax.failed`
case the original Phase 3 test used.

### Finding 2 — failure category and page count now reach the canonical fax record

**Bug:** `parseTelnyxFaxWebhookEnvelope` and the ingress queue already
carried the bounded `failure_category` (allow-listed via
`safeTelnyxFaxFailureCategory`) and `page_count` correctly, but
`processTelnyxFaxWebhookEvent` never forwarded either into
`recordFaxEvent`, and `recordFaxEvent` itself hardcoded an empty string
into the `fax_events.failure_category` column and never passed either
field into `applyFaxObservation`. An outbound `fax.failed` event with
`failure_reason: "user_busy"` correctly transitioned the fax to `failed`
while silently losing the reason at the canonical lifecycle boundary.

**Fix:** `FaxEventInput` gained optional `failure_category`/`page_count`
fields; `recordFaxEvent` now inserts the caller-supplied (bounded)
`failure_category` into the `fax_events` row instead of a hardcoded `''`,
and passes both fields through to `applyFaxObservation`'s existing
`failureCategory`/`pageCount` options (present since Phase 2.1 but never
previously invoked with real values from this path).
`processTelnyxFaxWebhookEvent` now passes the ingress row's own
`failure_category`/`page_count` on every call, regardless of
`normalized_state` — a non-failure observation's `failure_category` is
always `''`, which correctly *clears* rather than preserves any stale
category from an earlier failed attempt (verified by a dedicated test
using a fax parked in `ambiguous` with a pre-set category). A stale
(non-advancing) observation never reaches the write path at all — only a
classification of `"advanced"` triggers the UPDATE — so a stale event can
never overwrite the authoritative `page_count`/`failure_category` either,
while still being durably recorded in the ledger for evidence.

### Finding 3 — bounded expiry for the transient inbound media URL

**Bug:** the ingress queue captured `fax.received.payload.media_url` in
`transient_media_url` (correct — see "Media / document mode" and this
document's own field-omission list), but nothing ever made it actually
transient: there was no expiry tracking or cleanup mechanism, so an
already-expired signed URL could sit in the table indefinitely.

**Fix:** schema v33 (additive `ALTER TABLE ... ADD COLUMN`) adds
`transient_media_expires_at` to `telnyx_fax_webhook_events`.
`parseTelnyxFaxWebhookEnvelope` computes it conservatively from the
event's own `occurred_at` (never `received_at`/now, so a delayed-delivery
webhook never appears to grant extra validity) plus a cited constant,
`TELNYX_FAX_TRANSIENT_MEDIA_URL_VALIDITY_MS = 10 * 60 * 1000`, sourced
from the same `receive-a-fax-api` documentation cited above ("The
media_url is a signed AWS link valid for 10 minutes"). `''` (not a
fabricated value) when there is no `media_url` to expire. A new database
method, `clearExpiredTelnyxFaxTransientMedia(now)`, runs an `UPDATE ...
SET transient_media_url='', transient_media_expires_at='' WHERE
transient_media_expires_at != '' AND transient_media_expires_at <= ?` —
clearing only those two fields on expired rows, never touching the rest
of the ingress record (event identity, timestamps, `processing_status`
including `deferred_inbound`, `page_count`, `local_fax_id`, etc.) and
never touching `faxes`/`fax_documents`. Called once at backend startup
alongside the existing restart drain. Phase 4, when it exists, must treat
a fresh vs. expired/missing `transient_media_url` differently — an
expired URL is not itself an inbound-fax failure, and Phase 4 may use
`GET /v2/faxes/{id}` or another current Telnyx-supported reconciliation
path to obtain a fresh reference; that download path is explicitly not
implemented by Phase 3 or 3.1.

### Finding 4 — multi-page unresolved restart sweep

**Bug:** the startup recovery sweep called
`database.unresolvedTelnyxFaxWebhookEvents(100)` exactly once. Because a
still-unresolved row keeps reappearing on that same first page (ordered by
`occurred_at ASC, received_at ASC`), a single call could never advance
past it to see anything beyond the first 100 rows — an unresolved backlog
larger than 100 left everything past that page permanently unvisited
during a given startup, not merely slow to process.

**Fix:** a new database method,
`unresolvedTelnyxFaxWebhookEventsPage(afterRowId, limit)`, uses SQLite's
own implicit, stable, monotonically increasing `rowid` as a cursor
(`WHERE processing_status='unresolved' AND rowid > ? ORDER BY rowid ASC
LIMIT ?`) instead of the collision-prone `occurred_at`/`received_at`
pair. `server.ts`'s `drainUnresolvedTelnyxFaxWebhookEvents` is rewritten
as a bounded one-pass loop: fetch a page after the current cursor,
process each row, advance the cursor to that row's own `rowid`
**regardless of whether it resolves**, and stop as soon as a page comes
back empty. This guarantees every row unresolved at the start of the
sweep is visited exactly once, in a bounded number of pages, without
ever re-querying the same page — never a continuous poll. The single-page
`unresolvedTelnyxFaxWebhookEvents(limit)` method is retained unchanged
for the narrow, inherently-small-result-set post-binding re-trigger
(`unresolvedTelnyxFaxWebhookEventsByProviderFaxId`), which was never the
source of this bug.

### Finding 5 — evidence timestamp correction

The original Phase 3 evidence run
(`evidence/runs/20260910-fax-phase3-telnyx-fax-webhook-ingress.json`)
recorded `"timestamp": "2026-09-10T20:30:00Z"` — local clock time
mislabeled as UTC, inconsistent with the actual Phase 3 commit
(`7e65d20167d73b163529e51fb6d024fb1fa37bcd`, committed
`2026-09-11T01:05:28Z` UTC). Corrected in place to the commit timestamp,
with an explicit `date_correction` note preserving the fact and content of
the original error (the same convention used for the Phase 1 evidence
date correction) — see that file directly rather than this document for
the exact wording.

### Test coverage added in Phase 3.1

`database.test.ts`: `bindFaxProvider`/`bindFaxProviderIdentity` unaffected
(unchanged); new tests for the transient-media expiry lifecycle (fresh
URL retained, expired URL cleared while the rest of the row survives,
outbound rows/documents unaffected, restart-simulated cleanup), the
`unresolvedTelnyxFaxWebhookEventsPage` cursor walking a 130-row backlog
exactly once in a bounded number of pages, and a new v32→v33 migration
test proving the additive column survives an existing ingress row
(defaulting to `''`, never `NULL`). The pre-existing v26/v28/v29/v30
downgrade-fixture tests were corrected to also drop
`telnyx_fax_webhook_events` before rolling back their `PRAGMA
user_version` — a table that genuinely did not exist at those legacy
schema versions — fixing a latent "duplicate column name" bug that the
new non-idempotent `ALTER TABLE ADD COLUMN` (unlike the prior `CREATE
TABLE IF NOT EXISTS`) surfaced in those fixtures.

`telnyx-fax-webhook.test.ts`: replaced the invalidated inbound-`fax.failed`
direction-mismatch test with five focused tests (inbound `fax.failed`
deferred with zero local lookup even when its `provider_fax_id` matches an
existing outbound fax; outbound `fax.failed` still resolves normally; an
outbound-only event claiming inbound direction fails closed; an
inbound-only event claiming outbound direction fails closed; the
classifier functions' own unit behavior) plus a retained-intent
replacement for the local direction-mismatch guard; five tests for
failure-category/page-count propagation and non-regression on stale
events; two tests for `transientMediaExpiresAt` envelope parsing.

`server.test.ts`: a new integration test seeds a 150-row unresolved
backlog (one resolvable row at index 120, beyond the old 100-row page) via
`PhoneDatabase` directly, then calls `createBackend` fresh and proves the
resolvable event and a sample of permanently-unresolved rows on both
sides of the old page boundary are handled correctly in one startup
sweep, completing in well under 5 seconds.
