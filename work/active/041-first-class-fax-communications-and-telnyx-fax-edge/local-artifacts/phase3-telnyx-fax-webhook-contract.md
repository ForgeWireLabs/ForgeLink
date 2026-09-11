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

## Ingress queue schema (`telnyx_fax_webhook_events`, schema v32)

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
| `unresolved` | Authentic outbound event, no local fax could be resolved yet | (a) one-time startup sweep, (b) the explicit post-binding re-trigger — **never** the immediate drain loop, so this can never hot-loop |
| `deferred_inbound` | Authentic inbound event, intentionally not processed further in Phase 3 | nothing (terminal for this phase; Phase 4's own future consumer) |
| `unsupported` | Authentic event, `event_type` not in the allow-list | nothing (terminal) |
| `resolved` | Applied to a local fax via the normalized ledger | nothing (terminal) |
| `failed` | Processing itself failed (direction mismatch, invalid direction, internal error) | nothing (terminal) |

## Local fax resolution order (frozen, never heuristic)

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

Every inbound event type (`fax.receiving.started`,
`fax.media.processing.started`, `fax.received`) is authenticated, durably
enqueued, and classified `"deferred_inbound"` with **zero local fax
lookup, creation, or mutation attempted** — Phase 3 does not implement
inbound reception (FAX-007 remains pending). This status is deliberately
excluded from every drain trigger so it can never be mistaken for a failed
or stuck restart-recovery item; Phase 4 is expected to consume these
authenticated, bounded records as its own starting point rather than
re-authenticating raw payloads.

## Redaction and bounded retention

No raw webhook payload is ever persisted for fax (unlike the SMS/MMS
ingress table's bounded-lifetime `payload_json`) — only the extracted
bounded fields above. `internal_failure_reason` is never read. `bounded_error`
on a `"failed"` row is one of a small fixed set of internal category
strings (`invalid_direction`, `direction_mismatch`, `processing_failed`),
never a raw exception message or provider text. `delivery_target_hash`
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
