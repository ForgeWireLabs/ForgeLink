# WI041 Phase 0 — architecture and current-surface preflight

Read-only audit performed 2026-09-10, per the README's Phase 0 gate and the
AGENTS.md "Before implementation" checklist. No fax code, schema, or provider
calls were added in this pass. WI041 remains active/pending; this records the
insertion points so implementation (Phase 1+) can proceed against a checked
baseline rather than assumptions.

## 1. Channel registry / capability contracts

`Electron/backend/src/channels.ts` (work item 015, CLV-002):

- `ChannelKind = "native" | "internet" | "sms_mms_edge" | "voice_edge"` — no
  `fax_edge` variant exists yet. Confirms FAX-002: this must be added, not
  substituted for an existing kind.
- `Capability` is a closed union (`sms_send`, `mms_send`, `inbound_sms`,
  `delivery_status`, `voice_call`, `voice_start`, `voice_end`, `voice_status`,
  `inbound_call`, `media`, `email_send`, `inbound_email`, `push_send`) — no
  `fax_*` members. Confirms the `fax_send` / `fax_receive` / `fax_status` /
  `fax_cancel` / `fax_media` family from the README must be added here.
- `OutboundMessage = { to: string; body: string; mediaUrls?: string[] }` — a
  three-field message envelope. This is genuinely too narrow for a
  document/page/quality/cover-page fax request; confirms FAX-INV-3/FAX-002:
  fax needs its own `FaxRequest`/`FaxResult`/`FaxStatusUpdate`/`InboundFax`
  contracts (as specified in the README), not new optional fields bolted onto
  `OutboundMessage`.
- The registry (`ChannelAdapter`, `select()`, `hasCapability()`) is generic
  enough to register a `fax_edge` adapter once the kind/capabilities exist —
  no redesign needed there.

## 2. Current Telnyx SMS/MMS adapter and settings

`Electron/backend/src/telnyx.ts`:

- `TelnyxConfig = { apiKey, phoneNumber, profileId }` — `profileId` is a
  **messaging profile** id, not a Programmable Fax application/connection id.
  Confirms FAX-004/FAX-INV-5: fax needs its own `TelnyxFaxConfig` shape
  (`apiKeyRef`, `connectionId`, `faxNumber`, `webhookPublicKeyRef` per the
  README) rather than reusing `profileId`.
- `validateTelnyxCredentials()` calls Telnyx's number and messaging-profile
  endpoints — fax validation will need the equivalent for a fax
  application/connection and an eligible fax number; this is a new function,
  not an extension of the existing one.
- Credential encryption for SMS/MMS lives in a dedicated Electron main-process
  module, `Electron/smsProviderSettings.js`, using `safeStorage` (same pattern
  as `Electron/emailSettings.js` and `Electron/pushSettings.js`). Confirms the
  README's instruction to add a fax-specific settings module (e.g.
  `telnyxFaxSettings.js`) following this established pattern rather than
  extending `smsProviderSettings.js`.

## 3. Webhook boundary (hardened, reusable primitives)

`Electron/backend/src/server.ts` + `telnyx.ts`:

- A dedicated route already exists at `POST /webhooks/telnyx` (distinct from
  `/webhooks/sms`, `/webhooks/status`, `/webhooks/voice/*` for Twilio).
  Confirms a parallel `POST /webhooks/telnyx/fax` route is consistent with the
  existing pattern (WI037's per-product-family route separation).
- Signature verification: `verifyTelnyxWebhook(raw, timestamp, signature,
  process.env.TELNYX_PUBLIC_KEY)` reads the exact raw body and does Ed25519 +
  timestamp-freshness verification before parsing. This is the "hardened
  Telnyx signed-envelope boundary" the README says to reuse for fax. The
  public key handling (`TELNYX_PUBLIC_KEY`) is process-global today; a
  separate `webhookPublicKeyRef` for fax (per FAX-004) needs its own
  configuration path even if the underlying verify function is shared.
- Durable enqueue-before-ack + dedup + restart drain already exist for SMS/MMS:
  `TelnyxWebhookEventRow` (database.ts), `database.pendingTelnyxWebhookEvents()`,
  `database.completeTelnyxWebhookEvent()`, and `scheduleTelnyxWebhookDrain()`
  in server.ts (restart-safe redrain of unprocessed events). This is exactly
  the durable-queue primitive FAX-006 needs; fax should get its own event
  table (`fax_events`, per the README) reusing the same enqueue/dedupe/drain
  *pattern*, not the same table (event shapes and dedupe keys differ by
  product family per FAX-INV-5).
- `parseTelnyxWebhookEnvelope()` is SMS/MMS-specific event parsing and must
  not be reused for fax lifecycle parsing (README explicitly prohibits this;
  confirmed by reading the function — it assumes message-shaped event bodies).

## 4. Database schema and migrations

`Electron/backend/src/database.ts` + `migration.ts`:

- `CURRENT_SCHEMA_VERSION = 28`. The migration ladder is sequential
  (`version > CURRENT_SCHEMA_VERSION` throws; `version < CURRENT_SCHEMA_VERSION`
  triggers upgrade), matching decision 0011's schema-migration coordination
  invariant. Fax tables (`faxes`, `fax_documents`, `fax_events`) will need to
  land as version 29+ following that same ladder, with the same pre-migration
  backup pattern already proven for the existing 28-version history.
- No fax-shaped tables exist today; this is a clean addition, not a
  retrofit of an existing table.

## 5. Communication firewall / agent governance

Confirmed from `server.ts` imports: `FirewallBlockedError`, `OutboundDraftRow`,
evaluated communication firewall (`evaluateCommunicationFirewall`, referenced
in evidence run `20260624-agh019-communication-firewall.json`) already exists
as a channel-kind-scoped policy (`block` / `draft_only` / `require_approval` /
`allow`). Confirms FAX-010: adding `fax` as a governed channel kind to this
existing vocabulary is additive — no new firewall architecture is needed, only
a new channel-kind value and the fax-specific draft/approval wiring described
in the README (content-identity/hash rebinding on document replacement is new
logic, since no other channel kind currently carries a mutable document
artifact tied to an approval).

## 6. MCP surface

`mcp/forgelink-human/src/server.ts` exposes only human-message and
approval-request tools (`send_human_message`, `request_human_approval`,
`list_human_messages`, `get_human_message`, `dismiss_human_message`,
`record_human_action`, `channel_status`, plus the OCX-013 scoped read tools).
No fax tools exist. Confirms FAX-011: `fax.status`, `fax.draft.create`,
`fax.draft.inspect`, `fax.send.request_approval`, `fax.receipt.get`,
`fax.inbox.list` are new additions to this server once the local fax API is
stable, following the same scoped/redacted-response pattern already
established by `get_pending_approvals` / `get_contact_summary` /
`get_thread_summary`.

## 7. Tauri/mobile bridge

`Tauri/src-tauri/src/` currently contains `lib.rs`, `main.rs`,
`node_identity.rs`, and `node_identity_lifecycle.rs` — no provider-secret or
communications-data bridge commands yet. This matches work/README.md's
description of WI032: Tauri secure-storage/local-service parity is still
gated, not shipped. Confirms the README's Phase 7 sequencing (fax Tauri/mobile
parity coordinates with, and is gated by, WI032) is accurate to the current
repository state — there is no Tauri secret-storage surface today that fax
settings could ride even if Phase 2-5 landed early.

## Conclusion

Every material WI041 architectural assumption checked against the live
repository holds:

- `OutboundMessage` is genuinely too narrow for fax (FAX-INV-3 confirmed necessary, not aspirational).
- The Telnyx webhook boundary (signature verification, durable queue, restart drain) is real, hardened, and reusable as a *pattern* for a dedicated fax route/table (FAX-006 insertion point confirmed).
- Telnyx SMS/MMS configuration (`profileId`) is structurally distinct from what Programmable Fax needs (`connectionId`) — no accidental overlap risk (FAX-004/FAX-INV-5 confirmed).
- The communication firewall, schema-migration ladder, and MCP scoped-resource pattern are all generic enough to extend without architectural rework.
- Tauri/mobile has no secret-storage bridge yet, confirming WI041's Phase 7 must wait on WI032 rather than invent a parallel path.

No architectural contradiction was found between WI041's README and the
current repository. Implementation (Phase 1: fax domain and persistence) may
proceed on this basis in a future session; this session stops here per the
agreed scope (activation + WI042 + WI041 audit only — no live Telnyx
credentials were used or needed for this phase).

## Not yet done (explicitly out of scope for this pass)

- Re-verifying current Telnyx Programmable Fax API/webhook/connection/number
  semantics against live Telnyx documentation (README Phase 0 step 4) — this
  requires a live documentation fetch, deferred to the start of actual
  implementation so the information is fresh at the point it is frozen into
  code, not stale by the time Phase 2 starts.
- Any schema, contract, or code changes (Phase 1 onward).
- The live Telnyx acceptance gate (FAX-016) — requires operator-supplied test
  credentials, explicitly deferred; the operator has already offered to
  provide them when this phase begins.
