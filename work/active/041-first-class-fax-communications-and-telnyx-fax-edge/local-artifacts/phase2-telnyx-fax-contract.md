# WI041 Phase 2 — frozen Telnyx Programmable Fax contract

Verified 2026-09-10 against the authoritative Telnyx OpenAPI v3 spec
(`https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json`,
`team-telnyx/openapi`, fetched via `git`/`gh api` and inspected locally —
the file is 6.7MB and only partially renders through prose documentation
pages, so the spec itself is the primary source here, not the prose docs)
and the Telnyx developer docs below. This is the contract `telnyx-fax.ts`
implements; do not extend it without re-verifying against the live spec.

Sources:
- `https://github.com/team-telnyx/openapi` (`openapi/spec3.json`) — primary source of truth for this document.
- `https://developers.telnyx.com/docs/programmable-fax/sending-commands`
- `https://developers.telnyx.com/docs/programmable-fax/send-a-fax-api`
- `https://developers.telnyx.com/api-reference/programmable-fax-commands/send-a-fax`
- `https://github.com/team-telnyx/telnyx-node/issues/150` (evidence for the `contents`/media-mode discrepancy below)

## `command_id` — resolved discrepancy

The Telnyx "Sending Commands" prose documentation states that fax commands
support a `command_id` parameter with 60-second duplicate suppression.
**The actual `POST /v2/faxes` request schemas (`SendFaxRequest` and
`SendFaxMultipartRequest`) in the current OpenAPI spec do not include a
`command_id` property.** `telnyx-fax.ts` does not send `command_id`.
ForgeLink's own `local_fax_id` (Phase 1) and the atomic
`submission_pending -> submitting` claim (Phase 1.1/Phase 2's
`FaxSubmissionService`) remain the sole durable idempotency authority,
exactly as WI041's README already specified — this finding does not change
that architecture, it just confirms the field isn't there to lean on even as
a secondary signal for the send request itself.

## `POST /v2/faxes` — two mutually exclusive request modes

### `application/json` (`SendFaxRequest`)

Required: `connection_id`, `from`, `to`.
Optional: `media_url` **or** `media_name` (mutually exclusive with each other
and with `contents`), `from_display_name`, `quality` (enum `normal` / `high`
/ `very_high` / `ultra_light` / `ultra_dark`, default `high`), `t38_enabled`
(bool, default `true`), `monochrome` (bool, default `false`),
`black_threshold` (int 1–100, default `95`), `store_media` (bool, default
`false` — "does not support media_name, they can't be submitted together"),
`store_preview` (bool, default `false`), `preview_format` (`pdf`/`tiff`),
`webhook_url` (per-request override), `client_state` (must be valid base64;
echoed on every subsequent webhook and in the `Fax` resource).

### `multipart/form-data` (`SendFaxMultipartRequest`)

Required: `connection_id`, `contents`, `from`, `to`.
`contents` is a direct binary file upload, max 20MB, formats PDF/TIFF/JPEG/
PNG/DOC/DOCX/RTF/TXT; mutually exclusive with `media_name`/`media_url`.
Optional: `quality`, `t38_enabled`, `monochrome`, `store_media`,
`store_preview`. **`client_state` and `webhook_url` are not present in this
schema** — a fax submitted via `contents` cannot carry the opaque provider
correlation token. See "Media mode decision" below for the consequence.

A real-world SDK issue (`team-telnyx/telnyx-node#150`) shows a user hitting a
`422 'contents' is invalid` error via the Node SDK and confirms the
documentation/SDK-support gap the mission flagged; the raw HTTP API schema
itself is unambiguous per the OpenAPI spec above, so `telnyx-fax.ts` talks to
the HTTP API directly (no Telnyx SDK dependency) and follows the spec, not
the prose docs or the SDK.

ForgeLink sends only: `connection_id`, `from`, `to`, `quality` (only if it
maps to a known Telnyx value), plus either `media_url` (JSON mode) or
`contents` (multipart mode) and `client_state` (JSON mode only). Everything
else (`t38_enabled`, `monochrome`, `black_threshold`, `store_media`,
`store_preview`, `preview_format`, `webhook_url`, `from_display_name`,
`media_name`) is deliberately omitted — ForgeLink does not opt into
Telnyx-side media/preview retention it doesn't need, and does not override
the account-level webhook URL per request.

### Media mode decision

No public URL-serving mechanism exists in ForgeLink (and this phase does not
build one — inventing a public local-file URL or an insecure temporary
server was explicitly out of scope). `media_name` requires media already
uploaded to Telnyx's Media Storage product, which ForgeLink does not
integrate with. That leaves `contents` (multipart) as the only mode that can
actually send a ForgeLink-managed local document today, and the spec
confirms it is a real, currently-supported mode (not merely a documentation
error) — so it is implemented as the production resolver
(`createLocalFileFaxDocumentResolver`, reading from the same
`<dataDir>/uploads/` convention `server.ts` already uses for MMS media).
`media_url` is also implemented (`TelnyxFaxMediaSource = { kind: "media_url" }`)
for a future case where a document is already reachable via an authenticated/
signed URL, and is what deterministic tests use by default (a synthetic
`https://example.invalid/...` URL) since it needs no local file I/O.

**Known limitation:** because `contents` mode cannot carry `client_state`,
an outbound fax sent via the local-file resolver has no opaque correlation
token for Phase 3 webhook resolution. If such a send also lands in
`ambiguous` (network/timeout uncertainty) without ever capturing a provider
fax ID, ForgeLink cannot resolve it via `client_state` and must rely on
`GET /v2/faxes/{id}` reconciliation once a provider fax ID becomes known by
some other means, or an operator's manual judgment. This is a real,
recorded gap, not a blocking defect — see the WI041 README Phase 2 entry.

## Response — `202`

`{ "data": Fax }`. A `Fax` resource includes `id`, `connection_id`,
`direction`, `media_url`, `media_name`, `to`, `from`, `quality`, `status`,
`webhook_url`, `store_media`, `stored_media_url`, `preview_url`,
`client_state`, `created_at`, `updated_at`, `failure_reason` (nullable,
customer-facing category string), `internal_failure_reason`.
`telnyx-fax.ts` requires `data.id` to be a non-empty string on a `202`
response; a `202` with no usable `id` is treated as
`FaxProviderAmbiguousError("malformed_response", ...)`, never as a silent
success with no reconciliation identity.

## `status` enum (authoritative, from the `Fax` schema)

```text
queued, media.processed, originated, sending, delivered, failed,
initiated, receiving, media.processing, received
```

**There is no `cancelled` value in this enum.** This directly confirms the
mission's expected cancel-semantics constraint (see below).

`telnyx-fax.ts`'s `mapTelnyxFaxStatus` (outbound):

```text
queued          -> accepted
media.processed -> accepted   (collapses into the same neutral stage)
originated      -> sending    (Telnyx's own webhook-event list for a normal
                                outbound flow only names fax.queued,
                                fax.media.processed, fax.sending.started,
                                fax.delivered, fax.failed -- "originated" is
                                not among them, so it is mapped
                                conservatively as "in flight" rather than
                                assumed to mean something more specific)
sending         -> sending
delivered       -> delivered
failed          -> failed
```

(inbound, defined now for completeness even though Phase 2 does not build
inbound reception):

```text
initiated        -> receiving
receiving        -> receiving
media.processing -> processing
received         -> received
failed           -> failed
```

Any other/future status string maps to `null` and is treated as an unknown
observation: the fax's event is still durably recorded, but no state
mutation occurs (fail safe, per the mission's explicit requirement).

## `GET /v2/faxes/{id}`

`200` → `{ "data": Fax }`. `404` if the fax id is unknown to Telnyx. No other
documented status codes for this operation. Used for reconciliation
(`TelnyxFaxProvider.getFax`), fed through `applyFaxObservation` (Phase 1.1's
monotonic, skip-ahead-safe reconciliation), never through the strict local
command path.

## `POST /v2/faxes/{id}/actions/cancel`

`202` → `{ "data": { "result": "ok" } }` — **no fax status field at all**.
`404` if unknown, `422` if not eligible (Telnyx's own wording implies a
fax must be in an eligible in-flight state to be cancelled, though the spec
does not enumerate exactly which states qualify).

Given the response carries no fax status and the `status` enum has no
`cancelled` value, Telnyx's cancel command acceptance is **not** proof of a
terminal cancelled outcome. `TelnyxFaxProvider.cancelFax` returns a
`FaxResult` with `normalizedState: "cancel_pending"`, never `"cancelled"`.
The true outcome (the fax actually stopped, or it raced to `delivered`/
`failed` before cancellation took effect) can only be learned from a later
`GET`/webhook observation. **FAX-005's cancel criterion is satisfied only to
the extent of "correctly-modeled, non-overclaiming cancel request
construction and local state"; Telnyx cannot currently prove a terminal
cancelled state through any API ForgeLink has inspected.** This is recorded
as a known, accepted limitation rather than worked around by inventing a
`cancelled` mapping Telnyx does not actually provide.

## Fax Application (`connection_id`) — not a Messaging Profile

`GET /v2/fax_applications/{id}`: `FaxApplication.id` is typed `IntId` in the
spec (a numeric-looking string, e.g. `"1293384261075731499"`) — **not a
UUID**. `telnyx-fax.ts`/`telnyxFaxSettings.js` validate `connection_id` as a
bounded non-empty printable string, not a UUID pattern.

Relevant fields: `application_name`, `active` (bool), `webhook_event_url`,
`webhook_event_failover_url`, `outbound.outbound_voice_profile_id`,
`inbound.*`. **An Outbound Voice Profile attached to the Fax Application
(`outbound.outbound_voice_profile_id` non-empty) is required for outbound
fax to actually work** — a retrievable, active Fax Application alone does
not prove outbound readiness. `outbound_ready` is `true` only when this
field is present.

## Phone number assignment

No fax-specific phone-number lookup endpoint exists (unlike SMS's
`/v2/messaging_phone_numbers/{phoneNumber}`). The general
`GET /v2/phone_numbers?filter[phone_number]=<E.164>` endpoint is used
instead; its `numbers_PhoneNumberDetailed` schema exposes `status` (enum
including `active`) and `connection_id` (the number's assigned
connection/application). ForgeLink verifies the returned number's `status`
is `active` and its `connection_id` matches the configured Fax Application.
There is no explicit boolean `features.fax` field on this schema (unlike
SMS's `features.sms`); a number's assignment to a Fax Application connection
is the strongest available proof of fax eligibility this API exposes.

## Webhook public key

Telnyx signs webhooks account-wide with a single Ed25519 keypair (the same
verification mechanism already implemented for SMS in `telnyx.ts`), not a
separate key per product. `TELNYX_FAX_PUBLIC_KEY` is a deliberately separate
*configuration* field (per WI041's instruction that configuration ownership
stays separate even when the underlying value may eventually be identical to
the SMS one) — it does not imply a technically different cryptographic key.
Actual signature verification wiring is Phase 3 (the public webhook route);
Phase 2 only records whether this configuration field is present, as one
input to `inbound_webhook_ready`.
