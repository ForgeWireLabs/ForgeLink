# WI041 Phase 4 — inbound fax reception and document acquisition contract

Verified 2026-09-10 against:

- `https://developers.telnyx.com/docs/programmable-fax/sending-commands` —
  outbound fax webhook events (unchanged from Phase 3).
- `https://developers.telnyx.com/docs/programmable-fax/receive-a-fax-api` —
  inbound fax webhook payload fields, re-checked specifically for this
  phase. Confirmed field lists (superset of what this phase reads; see
  "Provider metadata used" below):
  - `fax.receiving.started`: `connection_id, direction, fax_id, from,
    status, to, user_id, caller_id`.
  - `fax.media.processing.started`: adds `page_count` to the above set.
  - `fax.received`: `call_duration_secs, connection_id, direction, fax_id,
    from, media_url, page_count, partial_content, status, to, user_id,
    caller_id`. **Confirmed: "This URL is valid for 10 minutes before the
    file is no longer accessible"** — the same figure Phase 3.1 already
    used for `TELNYX_FAX_TRANSIENT_MEDIA_URL_VALIDITY_MS`; no change to
    that constant was needed.
  - `fax.failed`: `connection_id, direction, failure_reason, fax_id, from,
    status, to, user_id, caller_id`.
- `https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json`
  (`team-telnyx/openapi`) — the same primary OpenAPI source Phase 2/3 used
  for the `Fax` resource schema; too large for full automated retrieval in
  one pass (same limitation recorded in the Phase 2/3 contracts), so the
  developer-docs pages above remain primary for event/payload specifics.

## `GET /v2/faxes/{id}` media-refresh conclusion (do not overclaim)

**Current Telnyx documentation does not state whether `GET /v2/faxes/{id}`
returns a refreshed/fresh `media_url` for an inbound fax once the original
webhook's signed URL has expired, and does not document an
inbound-specific size limit.** The `Fax` resource schema (confirmed by
Phase 2's earlier research) exposes `media_url` generically for both
directions, but nothing in current documentation guarantees that a GET
issued minutes or hours after `fax.received` returns anything other than
the same now-expired signed link, or that it returns one at all.

**This phase treats `GET /v2/faxes/{id}` as a best-effort provider
reconciliation source, never a guaranteed refresh.** Concretely:
`getTelnyxInboundFaxMediaReference` (`telnyx-fax.ts`) fetches and
normalizes whatever the Fax resource currently reports, with no assumption
about freshness. `fax-inbound-acquisition.ts`'s `resolveDownloadSource`
falls back to GET only when the ingress row's own transient webhook URL is
absent or past its recorded expiry, validates the response's `id` /
`direction` / `connection_id` before trusting any `media_url` it contains,
and — critically — if the GET-derived URL *also* turns out to be
unusable (the download attempt itself fails, e.g. a 403/404 from the same
expired signed link), the acquisition is left in a truthful `retryable`
state (or `unavailable` once bounded attempts are exhausted), never a
fabricated success. No test in this phase assumes GET produces a working
URL; the "GET yields no usable media" path is exercised directly
(`fax-inbound-acquisition.test.ts`: "a provider GET response for the
wrong fax id, direction, or connection is never trusted").

## Provider metadata used (and why only these fields)

Phase 3 deliberately minimized the ingress row shape. This phase extends
`telnyx_fax_webhook_events` (schema v34) with exactly four additional
bounded columns, chosen because each is a concrete, load-bearing
requirement for inbound reception, not merely because Telnyx supplies it:

- `connection_id` — the Fax Application ownership boundary (see below);
  without it, there is no way to reject an authentic event belonging to a
  different Fax Application in the same Telnyx account.
- `from_number` / `to_number` — become the canonical inbound
  `faxes.from_number`/`faxes.to_number` via `ensureInboundFax`; without
  them there is no inbound fax identity to create at all.
- `partial_content` — preserved as an informational/provider condition
  only (see "`partial_content` semantics" below); never translated into a
  completeness/corruption judgment by this phase.

Deliberately **not** added: `user_id`, `caller_id`, `call_duration_secs`,
or the raw provider JSON. None of them has a concrete ForgeLink
requirement in this phase, and Phase 3's "bounded extracted fields only,
never a raw payload" discipline continues to apply.

Existing Phase 3/3.1 `deferred_inbound` rows that predate this migration
have these four new columns blank. `fax-inbound.ts` handles this
honestly: `ensureInboundFax` only ever *fills* a currently-blank
from/to field from a later event, never overwrites a known value, and a
pre-migration row with a blank `connection_id` fails closed as
`foreign_connection` (see below) rather than being silently accepted —
this phase does not attempt provider-GET hydration of stale pre-migration
rows; any genuinely still-relevant one is expected to be superseded by
a fresh webhook delivery in the ordinary course of Telnyx's own retry
behavior.

## Fax Application ownership validation

Telnyx webhook signatures are account-level trust, not proof that an
event belongs to ForgeLink's configured Fax Application. Before any local
inbound fax is created or mutated, `processDeferredInboundFaxEvent`
(`fax-inbound.ts`) compares the event's `connection_id` against
`loadTelnyxFaxConfig().connectionId` (`TELNYX_FAX_CONNECTION_ID`). A
mismatch — including a blank configured connection id, which fails closed
rather than accepting every event by default — is durably classified
`foreign_connection` on the ingress row, with **zero local fax
lookup/creation/mutation**, and is never treated as a signature failure
(it is authentic, just outside ForgeLink's configured resource boundary).
`bounded_error`/logging for this disposition never includes the full
from/to numbers or the media URL.

**Product policy on `to` number matching:** this phase does **not**
additionally require the event's `to` number to match a single configured
fax number. A Telnyx Fax Application can legitimately have more than one
phone number assigned to it (the same way a Messaging Profile can own
multiple numbers), and ForgeLink's current configuration
(`TELNYX_FAX_PHONE_NUMBER`) records only the number used for *outbound*
sending readiness checks — there is no documented guarantee that inbound
reception is restricted to that single number if the Fax Application owns
others. Restricting inbound acceptance to one hardcoded number would
silently drop authentic inbound faxes to a second, equally legitimate
number on the same Fax Application. `connection_id` (the Fax Application
identity) is therefore the sole provider-ownership boundary this phase
enforces; the `to` number is stored as communication metadata only,
consistent with "Contact association" below.

## Inbound local identity semantics

`ensureInboundFax(provider, providerFaxId, from, to)` (`database.ts`) is
the atomic, idempotent seam:

- `(provider, providerFaxId)` not present → creates exactly one inbound
  fax with a freshly-generated `local_fax_id`.
- already present as inbound → returns the same local fax id (idempotent);
  fills a currently-blank `from`/`to` from this call's values without ever
  overwriting an already-known value.
- already present as a **different direction** (the same provider fax id
  somehow bound to an outbound fax) → returns `null`; the caller fails
  closed (`inbound_identity_conflict`), never guesses which record is
  correct.
- a same-process create race is recovered by re-reading rather than
  propagating a raw constraint error (mirrors Phase 3's
  `bindFaxProviderIdentity` pattern) — the `(provider, provider_fax_id)`
  unique index remains the final authority regardless.

No phone-number/timestamp heuristic is ever used to resolve identity —
`(provider, providerFaxId)` is the sole authority, exactly as for outbound.

## Transport state vs. document acquisition state

`faxes.state` (`FaxState`: `receiving`/`processing`/`received`/`failed`
for inbound) answers *what happened to the transmission*, applied through
Phase 1.1's monotonic `applyFaxObservation` exactly as before — Phase 4
introduces no new transport states and no new transitions. A new, wholly
separate column, `faxes.document_acquisition_state`
(`FaxDocumentAcquisitionState`: `not_required` / `pending` / `acquiring` /
`available` / `retryable` / `quarantined` / `unavailable` / `deleted`),
answers *do we have a safe durable local copy of the document*. The two
are never conflated:

- `fax.state = received` + `document_acquisition_state = acquiring` is a
  valid, expected combination while a download is in progress.
- `fax.state = received` + `document_acquisition_state = quarantined` is
  equally valid — a received fax whose PDF failed local validation is
  **never** retroactively reported as a failed transmission (proven by
  `fax-inbound.test.ts`: "transport state and document acquisition state
  are independent").
- Conversely, a successful document commit never fabricates a `received`
  transport observation the provider did not actually report — acquisition
  is only ever claimed in response to a genuine `fax.received` event.

The durable authority for the acquisition *workflow itself* (attempts,
backoff, source, hash/size once known) is the new `fax_inbound_acquisitions`
table, keyed `(provider, provider_fax_id)` — `faxes.document_acquisition_state`
is a single-writer mirror of that authority's current state, kept in sync
by every write to the acquisition row, so ordinary fax-list/fax-detail
reads never need to join the acquisition table for the common case.

## Media source selection and GET fallback

Per acquisition attempt (`resolveDownloadSource`, `fax-inbound-acquisition.ts`):

1. If the acquisition's own `source_reference` (the webhook's transient
   `media_url`, captured at claim time) is present and its recorded
   `source_reference_expiry` has not passed → use it directly
   (`source_kind: "webhook_media_url"`). No GET call.
2. Otherwise, call `getTelnyxInboundFaxMediaReference` (an authenticated
   `GET /v2/faxes/{id}`) and validate the response before trusting
   anything it returns: `id == expected providerFaxId`, `direction ==
   "inbound"`, `connection_id == configured Fax Application`. Any mismatch
   → the attempt fails as a bounded `provider_get_*` retryable reason, and
   **no download is ever attempted** against a mismatched reference.
3. If GET is unreachable, or returns no usable `media_url`, the attempt is
   a truthful `retryable` failure (never a fabricated success) — see the
   `GET` conclusion above.

## Media URL / SSRF trust boundary

Every media URL, regardless of source, passes through `validateMediaUrl`
before any request is made: HTTPS-only, no embedded username/password,
bounded length (≤2048 chars), and a forbidden-host check rejecting
`localhost`, loopback (`127.0.0.0/8`, `::1`), private ranges (`10/8`,
`172.16/12`, `192.168/16`), link-local (`169.254/16`, IPv6 `fe80::/10`),
and IPv6 unique-local (`fc00::/7`). Redirects (`3xx`) are followed
**manually**, one hop at a time, with every hop re-validated by the same
function and a hard cap of 3 hops (`too_many_redirects` beyond that) —
never delegated to the fetch implementation's own automatic redirect
following, and the Telnyx API `Authorization` header is never attached to
any hop of the media download (see "Credential separation" below).

**Documented residual limitation:** this is a point-in-time check against
the URL's literal hostname/IP form. A hostname that only resolves to a
private/loopback address at actual connection time (DNS rebinding) is not
caught by this check — Node's `fetch` does not expose a pre-connect
IP-pinning hook this phase's implementation uses. HTTPS-only plus the
literal-host/IP checks are the strongest practical validation available
without introducing a custom low-level socket/DNS layer, which this phase
does not add. This is recorded honestly rather than silently assumed away.

No historical S3 hostname (or any other specific delivery host) is
hardcoded or allow-listed — current Telnyx documentation does not
guarantee a fixed delivery host, so validation is scheme/credential/host-
class based rather than a hostname allow-list.

## Credential separation (proven in tests)

The Telnyx API `Authorization: Bearer ...` header is attached only inside
`getTelnyxInboundFaxMediaReference`'s own request (via `telnyx-fax.ts`'s
existing `authHeaders`) — the media-download request in
`downloadToStaging` never sets an `Authorization` header on any hop.
`fax-inbound-acquisition.test.ts`'s "a fresh webhook media URL is used
directly... the Telnyx bearer token is never sent to it" test asserts this
directly by inspecting the headers actually seen by an injected fetch
implementation across both call sites in the same test run.

## Bounded streaming and the ForgeLink inbound size limit

`FAX_INBOUND_MAX_BYTES = 20 * 1024 * 1024` (20MB) —
**a ForgeLink-defined conservative safety limit, not a claimed Telnyx
protocol limit**; current Telnyx documentation does not publish an
inbound-specific size limit as of this phase's verification date. Chosen
to match the existing outbound multipart limit
(`TELNYX_MULTIPART_MAX_BYTES` in `telnyx-fax.ts`) for consistency, since
inbound PDFs are generated from the same class of fax transmission.
`Content-Length` is checked when present (an oversized declared length is
rejected before any body streaming begins) but is never trusted
exclusively — the response body is streamed via the Web Streams
`ReadableStream` reader in bounded chunks, with the running total checked
against the limit on every chunk; exceeding it aborts the stream
immediately (`reader.cancel()`) rather than ever calling an unbounded
`response.arrayBuffer()`. `fax-inbound-acquisition.test.ts` proves both
the declared-Content-Length and the no-header/mid-stream cases.

## PDF validation and quarantine

Only a downloaded body that begins with the PDF magic bytes (`%PDF-`) is
ever committed as a managed document. Everything else — oversized
(discarded outright; there is nothing useful to retain from a deliberately
truncated stream), zero-byte, wrong magic bytes, or a `Content-Type`
header that explicitly contradicts non-PDF content — is either discarded
or moved into `ManagedDocumentStore`'s `quarantine/` subdirectory via
`quarantineStaged`, **never** committed to `documents/`, **never**
associated with a `fax_documents` row, and **never** treated as a
transport failure of the underlying fax (see "Transport state vs.
acquisition state" above). No content is executed, rendered, OCR'd, or
otherwise actively interpreted during acquisition — the magic-byte check
is the only content inspection this phase performs.

`internal_failure_reason`-equivalent detail is never persisted for
acquisition failures either: `last_safe_error` on `fax_inbound_acquisitions`
is always one of a small fixed set of bounded category strings
(`document_too_large`, `empty_body`, `not_pdf`, `content_type_mismatch`,
`http_<status>`, `network_error`, `stream_error`, `redirect_*`,
`provider_get_*`, `too_many_redirects`), never raw exception text or
provider response bodies.

## `partial_content` semantics (frozen as "unclear", not guessed)

Telnyx's `fax.received` payload documents a `partial_content` field but
current documentation does not adequately define its exact semantics
(what specifically makes content "partial", how it interacts with
`page_count`, or what a consuming application should do about it). Per
the mission's explicit instruction, this phase does **not** silently
translate it into `complete`/`corrupt`/`failed`. It is parsed and stored
as a bounded, informational value only (`telnyx_fax_webhook_events.partial_content`,
`0`/`1`/`NULL`) and has **no product consequence** in this phase — no
acquisition-state decision, no UI surfacing (there is no Fax UI yet). Any
future phase that wants to act on it must first re-verify Telnyx's actual
documented semantics.

## Managed document storage — architecture and location

`ManagedDocumentStore` (`managed-document-store.ts`) is a provider-neutral
primitive under `<dataDir>/managed-documents/` — **not** `<dataDir>/uploads/**`,
which participates in the existing public `/media/:filename` route and
is not an acceptable authority for private received fax content. Three
subdirectories: `staging/` (temporary, never open-able, unconditionally
swept on restart — see below), `documents/` (committed, immutable,
opaque-id-named artifacts), `quarantine/` (failed-validation content,
never associated with a `fax_documents` row, never reachable via any
open/serve path). Atomic commit: `beginStaging()` creates a zero-byte
placeholder so a crash before the first byte is still detectable by the
staging sweep; the caller streams bytes into that same file; `commit()`
recomputes hash/size **from the file on disk** (never a caller-supplied
claim) and performs an `fs.rename` into `documents/`, atomic because
staging/documents/quarantine always share one root (same filesystem/volume).

**Proof it is never generically media-served:** `/media/:filename`
(`server.ts`) resolves strictly under `<dataDir>/uploads/`, a completely
separate directory tree from `<dataDir>/managed-documents/` — structurally
unreachable via that route regardless of filename. `server.test.ts`'s
end-to-end inbound test additionally proves this empirically: after a
real inbound acquisition completes, `GET /media/<the document's actual
local_ref>` and `GET /media/<the document's id>.pdf` both fail to return
the content. The managed document's own `local_ref` is `documents/<opaque
id>` — never the provider's signed URL, never a raw filesystem path
outside the store, never a provider-supplied filename.

`fax_documents` (the existing Fax-domain association table) remains the
single owner of the Fax-specific document metadata — `local_ref`,
`content_type`, `content_sha256`, `byte_size`, `page_count`, retention
state. **No new generic `managed_documents` table was introduced.** This
was a deliberate architectural decision after inspecting the existing
`fax_documents` shape: it already carries everything a "managed document
association" needs, so introducing a second, competing document-metadata
table would only create ambiguity about which one is authoritative. The
`ManagedDocumentStore` filesystem primitive itself, however, is
intentionally reusable and provider/source-neutral — FAX-009 (camera
scans, local device import, Google Drive, OneDrive/SharePoint, Dropbox)
is expected to stage/commit through this exact same primitive in a later
phase; no source adapter for any of those is implemented here.

## Durable acquisition authority and restart recovery

`fax_inbound_acquisitions`, keyed `(provider, provider_fax_id)`, is the
single durable authority for the acquisition workflow — the primary key
itself is the concurrency guard ensuring at most one active acquisition
per inbound provider fax, so a duplicate `fax.received` webhook (Phase
3.1's own dedup notwithstanding) can never start a second, concurrent
download; `claimInboundFaxAcquisition` is `INSERT OR IGNORE`, so only the
first claim for a given provider fax id ever creates the row or sets
`document_acquisition_state` to `pending`.

`claimNextInboundFaxAcquisition` is a bounded, CAS-guarded claim (`pending`,
or `retryable` whose `next_retry_at` has passed) that atomically transitions
the row to `acquiring`. Restart recovery
(`recoverInboundFaxAcquisitions`) does two things unconditionally at
backend startup: (1) `recoverStaleInboundFaxAcquisitions` resets any row
stuck `acquiring` past a 5-minute staleness threshold back to `retryable`
(a worker that crashed mid-download never permanently blocks that
provider fax); (2) `ManagedDocumentStore.sweepAbandonedStaging()` deletes
every file still under `staging/` — provably safe, since a committed file
is always renamed *out* of `staging/` before anything could observe it
there, so anything still present was abandoned by an interrupted attempt.
Both are exercised directly in `fax-inbound-acquisition.test.ts` and
`managed-document-store.test.ts`.

Retry policy: up to 6 attempts total, exponential backoff (30s base,
doubling, capped at 1 hour) between `retryable` attempts, never an
unbounded loop, and never a resend of the fax itself (this is a read/
download operation only). Exhausting attempts reaches a terminal
`unavailable` state — never a fabricated `available`, and never a
transport-state mutation.

## Consuming `deferred_inbound` without triggering a network download from the ordinary drain

Two separate sweeps in `server.ts`, matching the mission's explicit
requirement:

1. `scheduleInboundFaxProcessing` — DB-only (`fax-inbound.ts`, via
   `deferredInboundTelnyxFaxWebhookEventsPage`'s rowid-cursor pagination,
   mirroring Phase 3.1's unresolved-event sweep design). Consumes
   `deferred_inbound` rows: ownership validation, `ensureInboundFax`,
   observation application, acquisition claim. **No network call.**
2. `scheduleInboundFaxAcquisitionBatch` — the only place that performs a
   network download for inbound fax; claims and processes a bounded batch
   (default 5) of due acquisitions via `runInboundFaxAcquisitionBatch`,
   using `BackendOptions.faxInboundFetch` (defaults to real global
   `fetch`; every test injects a synthetic implementation).

`telnyx_fax_webhook_events.processing_status` gained two Phase 4 terminal
values: `inbound_applied` (a `deferred_inbound` row successfully
synchronized into local fax state) and `foreign_connection` (rejected at
the ownership boundary). Neither is ever revisited by any sweep.

## Backup, restore, deletion

`createBackup`/`restoreLatest` (`server.ts`) now `cp`/restore
`<dataDir>/managed-documents/` alongside the existing `uploads/` tree,
excluding `staging/` from the copy (an in-flight download's partial bytes
are never worth capturing in a backup) via `fs.cp`'s `filter` option. A
rollback-safe rename-aside/restore-back pattern mirrors the existing
`uploads/` handling exactly, including on a failed restore. Proven in
`server.test.ts`: a backup captures a committed managed document; deleting
the on-disk bytes and restoring brings them back with a verified matching
hash; a document deliberately still missing after a manual delete is
correctly reported as missing by `ManagedDocumentStore.inspect`, never
silently assumed present — an explicit integrity-check proof, not merely
"restore succeeded."

`database.deleteFaxDocument(id)` (new) marks the `fax_documents` row
`retention_state='deleted'` (preserving minimal delivery evidence, matching
the table's existing soft-delete convention) and returns the row's
`local_ref` exactly once, so the caller can remove the underlying bytes
via `ManagedDocumentStore.delete` — a second deletion attempt on an
already-deleted row is a safe no-op, never a repeat file-removal attempt,
and the method never touches an unrelated document.

## Provider transient URL cleanup

Once `fax-inbound-acquisition.ts` successfully commits the local managed
artifact, it immediately clears the originating ingress row's
`transient_media_url`/`transient_media_expires_at`
(`clearTelnyxFaxWebhookEventTransientMedia`, a new single-row-targeted
variant of Phase 3.1's bulk `clearExpiredTelnyxFaxTransientMedia`) —
proven in `fax-inbound-acquisition.test.ts`. If acquisition never
succeeds, the existing Phase 3.1 bulk expiry sweep still clears the URL
once its recorded expiry passes, exactly as before; Phase 4 does not
change that policy for the not-yet-acquired case.

## Known limitations (honest, not hidden)

- No guarantee `GET /v2/faxes/{id}` returns a *fresh* media reference once
  the webhook's own signed URL has expired — see the dedicated conclusion
  above. An inbound fax whose webhook URL expired before acquisition began
  and whose GET-derived reference is also unusable will reach `unavailable`
  after bounded retries, with no document ever acquired. This is a real,
  recorded limitation of the currently-documented Telnyx contract, not a
  bug in this implementation.
- The media-URL validation is a point-in-time literal host/IP check; DNS
  rebinding between validation and connection is not defended against (see
  "Media URL / SSRF trust boundary" above).
- `partial_content`'s actual semantics remain unverified by current
  Telnyx documentation; it is preserved but has no product consequence.
- This phase does not implement inbound document download retry driven by
  operator action, the Fax Inbox UI, MCP fax tools, agent governance, or
  Tauri/mobile parity (FAX-008/009/010/011 remain future work; see the
  WI041 README).
- FAX-013 (full retention/privacy policy integration) is not claimed
  satisfied by the deletion primitive introduced here — that primitive is
  necessary infrastructure for FAX-013, not the criterion's complete
  fulfillment.
