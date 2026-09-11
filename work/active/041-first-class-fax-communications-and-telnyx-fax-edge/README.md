# Work Item 041 — First-Class Fax Communications and Telnyx Fax Edge

**Status:** Active (Phase 1/1.1 fax domain/persistence landed; Phase 2/2.1 Telnyx outbound edge landed and hardened; inbound/webhook/UI/MCP not yet started)  
**Priority:** High product expansion  
**Created:** 2026-09-10  
**Primary product:** ForgeLink  
**Initial provider:** Telnyx Programmable Fax  
**Depends on:** 015, 016, 035  
**Coordinates with:** 032, 037, 040

## Intent

Add fax as a first-class ForgeLink communications capability that a person can use directly from the ForgeLink UI, while preserving the ability for agents and external applications to use the same capability through governed ForgeLink APIs and MCP.

Fax is not a ForgeWire feature that happens to call ForgeLink. ForgeWire, Fabric, AgentRun, and GraphRuntime are not required for ordinary fax use. ForgeLink owns the fax domain, the human UX, provider credentials, document references, transmission state, inbound reception, delivery evidence, retention, and communication authority. ForgeWire may later consume the capability through ForgeLink's existing MCP/API boundary exactly as another external agentic client can.

This work item also clarifies an important product truth that already exists in the codebase: ForgeLink is not only an agent-to-human bridge. It is a local-first communications and human-authority platform usable by humans, agents, and applications. Agent-facing surfaces are one interface into that product, not its definition.

## Product decision

The binding product shape is:

```text
                         ForgeLink
                            |
        +-------------------+-------------------+
        |                   |                   |
     Human UI          Agent / MCP API      Applications
        |                   |                   |
        +-------------------+-------------------+
                            |
                    Communications Core
                            |
          +-----------------+----------------+
          |                 |                |
       SMS/MMS            Voice             Fax
          |                 |                |
       adapters           adapters          adapters
                                             |
                                      Telnyx Fax Edge
                                             |
                                           Telnyx
```

The ordinary user path is intentionally independent of any agent runtime:

```text
Human
  -> ForgeLink UI
  -> New Fax
  -> choose or scan document
  -> enter recipient
  -> preview
  -> send
  -> ForgeLink fax domain
  -> Telnyx
  -> delivery receipt
```

The optional agentic path is:

```text
ForgeWire / Claude / Codex / another agent or application
  -> ForgeLink MCP/API
  -> create fax draft
  -> ForgeLink communication policy
  -> human review/approval when required
  -> ForgeLink fax domain
  -> Telnyx
```

No external caller receives Telnyx credentials or becomes the fax lifecycle authority.

## Why fax belongs in ForgeLink

ForgeLink already owns the primitives fax needs:

- human-operated communications UI;
- provider-neutral communications architecture;
- Telnyx credential/configuration handling;
- signed Telnyx webhook verification;
- durable event ingestion, deduplication, ordering, and restart recovery;
- contacts and external identities;
- local inbox/outbox semantics;
- communication firewall and draft-don't-send behavior for agents;
- approval and evidence records;
- local data, retention, export, backup, and audit infrastructure;
- Tauri desktop/mobile direction;
- MCP/API access for external agentic clients.

A separate fax application backend would duplicate those systems and create another credential, policy, retention, and delivery-state owner. The desired user experience may eventually be exposed as a focused ForgeLink mode or packaged surface, but the fax domain authority remains ForgeLink.

## Core architectural invariants

### FAX-INV-1 — Human use is first-class

A human must be able to send, receive, inspect, retry, cancel where supported, download, print/export, and manage fax records directly through ForgeLink without ForgeWire, an LLM, an agent, MCP, or Fabric.

### FAX-INV-2 — ForgeLink owns communications authority

ForgeLink owns fax state, provider selection, provider credentials, recipient/contact linkage, policy, send authority, inbound reception, delivery evidence, retention, and audit. External runtimes may request actions but do not become co-owners of those concerns.

### FAX-INV-3 — Fax is a distinct document-transmission domain

Do not force fax into the existing SMS/MMS `OutboundMessage` shape. Fax has materially different semantics: documents/pages, rendering, quality, cover metadata, asynchronous transmission stages, receive artifacts, provider media handling, receipts, and longer-lived lifecycle evidence.

Fax may participate in the shared communications capability registry, but it must have a specialized fax contract and domain model.

### FAX-INV-4 — Provider neutrality survives the first implementation

Telnyx is the first fax provider because ForgeLink already has a Telnyx relationship and hardened provider boundary. The core fax model must not encode Telnyx-specific field names, event names, connection IDs, URLs, or error bodies into provider-neutral records.

### FAX-INV-5 — Telnyx capability families remain separate

Telnyx SMS/MMS, Telnyx Voice, Telnyx AI/inference elsewhere in the ecosystem, and Telnyx Programmable Fax are separate product/configuration families even if one operator account or API key can authorize more than one family.

A Telnyx messaging profile is not a fax application. Fax configuration must model its own fax application/connection identity, number eligibility, webhook route, health, and capability truth.

### FAX-INV-6 — Durable local state precedes network side effects

For outbound fax, ForgeLink creates the local transmission record and immutable/document reference before attempting the provider call. For inbound fax, provider events are authenticated and durably queued before asynchronous processing. Restart must not erase whether a transmission was attempted, accepted, ambiguous, delivered, failed, or received.

### FAX-INV-7 — Duplicate and out-of-order events are normal

Provider event handling must be idempotent, order-aware, and restart-safe. Event identity and occurred-at semantics are durable. Arrival order is not treated as lifecycle order.

### FAX-INV-8 — Documents are referenced, not sprayed across subsystems

Where possible, components pass opaque local document references rather than duplicating fax payload bytes. Provider payloads, temporary media URLs, API credentials, and private documents do not become durable engineering evidence, logs, notification bodies, or cross-system metadata.

### FAX-INV-9 — Human sends and agent sends have different authority paths

A person pressing **Send Fax** in the authenticated ForgeLink UI is an operator action and does not require the agent communication firewall merely because agents also exist in the product.

Agent-originated fax requests remain governed by the communication firewall, consent/purpose policy, and draft-before-send posture unless explicit direct-send authority has been granted.

### FAX-INV-10 — No compliance claim is implied

Adding encrypted storage, signed webhooks, retention controls, auditability, or provider configuration does not by itself make ForgeLink HIPAA compliant, SOC 2 certified, PCI compliant, or legally approved for any regulated workflow. WI040 remains the regulated communications policy authority.

## Provider-neutral fax domain

The implementation should introduce a fax-specific capability family rather than widening message fields until they become ambiguous.

Conceptual channel/capability shape:

```text
ChannelKind
  ...
  fax_edge

Capabilities
  fax_send
  fax_receive
  fax_status
  fax_cancel
  fax_media
```

The exact TypeScript/Rust names may change during implementation, but the semantic separation is binding.

### Conceptual contracts

```text
FaxProvider
  capabilities()
  validateCredentials()
  sendFax(request)
  cancelFax(providerFaxId)          optional by provider capability
  getFax(providerFaxId)            reconciliation
  parseFaxEvent(payload)
  fetchInboundDocument(reference)  provider-specific boundary

FaxRequest
  localFaxId
  from
  to
  documentRef
  coverMetadata? / coverDocumentRef?
  quality?
  clientState?
  correlation?

FaxResult
  providerFaxId
  normalizedState
  providerAcceptedAt?
  safeProviderCode?

FaxStatusUpdate
  providerFaxId
  normalizedState
  occurredAt
  safeProviderCode?
  terminal

InboundFax
  providerFaxId
  from
  to
  occurredAt
  pageCount?
  remoteDocumentRef
  providerMetadataSubset
```

`raw` provider bodies may be available transiently inside provider code when needed for correctness, but they are not the canonical domain record and are not automatically surfaced to the renderer, logs, MCP, evidence, or audit.

## Durable data model

Do not store fax transmissions as disguised SMS rows. Reuse ForgeLink identity/contact/media infrastructure where appropriate, but establish dedicated records for the fax lifecycle.

Conceptual tables/entities:

```text
faxes
fax_documents
fax_events
```

A `faxes` record should be able to represent at least:

- stable local fax ID;
- direction: inbound or outbound;
- contact/contact-point linkage where known;
- from/to numbers in the minimum durable form required by product and policy;
- provider name;
- redacted/provider fax identifier needed for reconciliation;
- document reference(s), not arbitrary duplicated payloads;
- page count when known;
- quality/resolution selection when relevant;
- normalized lifecycle state;
- created/submitted/started/delivered/received/failed/cancelled timestamps as applicable;
- safe failure category/code;
- operator/agent/application provenance;
- approval/draft linkage when applicable;
- classification and handling-policy references once WI040 contracts are available;
- retention/deletion state;
- correlation IDs that are safe and intentionally admitted.

A `fax_events` record should preserve enough provider-neutral evidence to reconstruct lifecycle decisions without retaining whole webhook bodies indefinitely:

- provider event ID;
- local fax ID;
- provider fax ID as policy permits;
- normalized event type/state;
- safe provider event type/code where useful;
- occurred-at;
- received-at;
- attempt/retry metadata where supplied;
- payload hash or equivalent integrity reference where appropriate;
- processing status;
- bounded redacted failure category;
- retention disposition for transient raw content.

## Normalized lifecycle

The exact state enum should be sealed before implementation. At minimum it must distinguish meaningful local states such as:

```text
draft
prepared
pending
submitted
queued
processing_media
transmitting
delivered
received
failed
cancelled
ambiguous
```

Provider-specific transitions map into this model without pretending that states from every provider are identical. A safe provider detail code can coexist with the normalized state.

The state machine must explicitly define:

- legal forward transitions;
- terminal states;
- duplicate transitions;
- backward/out-of-order events;
- late success after an apparent timeout;
- definite pre-send failure versus ambiguous post-submit failure;
- cancellation races;
- reconciliation after restart or webhook loss;
- retry eligibility without duplicate external transmission.

## Telnyx Programmable Fax edge

Telnyx is the first adapter, but it is not the core fax model.

Create a fax-specific Telnyx implementation rather than extending the current SMS/MMS adapter until it owns unrelated product families. Conceptually:

```text
backend/src/telnyx.ts          -> SMS/MMS edge
backend/src/telnyx-fax.ts      -> Programmable Fax edge
```

Shared provider primitives should be factored only when they are genuinely the same contract, for example:

- bearer authorization mechanics;
- safe HTTP/error helpers;
- Ed25519 webhook signature verification;
- timestamp freshness verification;
- common redaction helpers.

Do not share lifecycle parsers merely because event envelopes come from the same company.

### Telnyx fax configuration

Fax configuration must be distinct from the messaging-profile configuration. The operator should be able to configure/validate/select fax capability using the Telnyx fax application/connection and an eligible fax number without implying that SMS configuration automatically makes fax ready.

Conceptual configuration:

```text
TelnyxFaxConfig
  apiKeyRef
  connectionId
  faxNumber
  webhookPublicKeyRef
```

Secret values remain in the approved ForgeLink protected-storage boundary and are never returned to renderer state, diagnostics, MCP clients, evidence files, or support output.

### Outbound Telnyx fax

The adapter should use Telnyx's Programmable Fax API through a narrowly owned send path. Provider response content is normalized immediately into the local fax record.

The send path must answer:

- Was the request rejected before Telnyx could accept it?
- Was a provider fax ID returned?
- Is retry safe?
- Could retry duplicate a transmission?
- What safe status/error detail is useful to the user?
- How is a stale or ambiguous row reconciled later?

No generic automatic retry may occur after an ambiguous side effect unless duplication safety can be proven.

### Telnyx fax webhooks

Use a dedicated route, conceptually:

```text
POST /webhooks/telnyx/fax
```

Do not mix fax lifecycle interpretation into the existing messaging webhook handler.

Reuse the hardened Telnyx signed-envelope boundary from WI037 where appropriate:

1. read the exact raw request body;
2. verify Ed25519 signature;
3. enforce bounded timestamp freshness;
4. parse only after authenticity succeeds;
5. extract a bounded event envelope;
6. durably enqueue before acknowledging;
7. deduplicate by provider event ID;
8. process in occurrence order where required;
9. map only allow-listed fax event types;
10. retain raw payload only as long as processing/recovery requires.

Unknown authentic events are acknowledged and recorded as unsupported rather than guessed into fax state.

Outbound lifecycle support should include the Telnyx fax event family needed to distinguish queueing, media processing, transmission start, delivery, and failure. Inbound lifecycle support should preserve reception events and document acquisition without assuming webhook arrival order.

## Inbound fax and number ownership

Receiving fax is a first-class product path, not an afterthought attached to send.

ForgeLink must be able to represent:

```text
Fax Inbox
  -> inbound event authenticated
  -> local inbound fax record created/reconciled
  -> remote provider document fetched through provider boundary
  -> media validated
  -> local managed document persisted
  -> provider URL/reference discarded when no longer required
  -> user notified using redacted metadata
```

Inbound document acquisition must enforce bounded and testable controls for:

- authenticated provider download;
- HTTPS/scheme and redirect policy;
- host restrictions where applicable;
- MIME/content-type allow-list;
- file/page/aggregate size;
- decompression/resource limits;
- timeouts;
- malicious or malformed document handling;
- quarantine/failure state;
- retention/deletion;
- backup/export policy;
- renderer-safe local opaque references.

A temporary Telnyx media URL is not a durable user document reference.

Number provisioning, purchasing, porting, and billing mutations are not implicit requirements of the first fax slice. The first implementation may operate against an operator-configured existing Telnyx fax-capable number. Any future automatic number purchase/provision/release flow requires an explicit preview, billing impact, ownership model, cancellation/rollback contract, and separate acceptance evidence.

## ForgeLink user experience

Fax should appear as a native ForgeLink communications surface, not as an advanced provider setting hidden from normal users.

Conceptual navigation:

```text
Channels / Communications
  Messages
  Calls
  Fax
  Email
  Agent Requests
  Notifications
```

The exact shell navigation remains subject to the shared cockpit design, but Fax should provide at least:

### New Fax

- recipient number/contact picker;
- add/import one or more documents;
- reorder/remove pages or documents where the rendering pipeline supports it;
- optional cover page;
- sender/subject/note fields that map cleanly to the produced fax document rather than hidden provider-only metadata;
- page count before send when feasible;
- quality/resolution selection only if the user needs it;
- preview of the exact transmission document;
- provider/readiness indication without exposing credentials;
- estimated provider cost when accurate cost data is available; unknown cost must remain unknown rather than fabricated;
- explicit **Send Fax** action.

### Sent

- recipient/contact;
- page count;
- submitted/transmitting/delivered/failed state;
- timestamps;
- safe error reason/remediation;
- receipt/details view;
- retry when safe;
- cancel when supported and meaningful;
- document open/export/delete according to retention policy.

### Inbox

- sender/contact when resolvable;
- receiving number;
- received timestamp;
- page count;
- unread state;
- document preview/open/export/delete;
- retention/classification indicator where policy requires one.

### Fax Settings

- provider selection/readiness;
- Telnyx fax application/connection selection or configuration;
- fax-capable number selection/validation;
- signed webhook readiness;
- inbound/outbound capability truth;
- retention/default-delete behavior;
- diagnostic health without secrets or private documents.

The main UI should remain usable by an ordinary person who does not know what a messaging profile, connection ID, webhook signature, SIP trunk, or T.38 session is. Provider details belong in Settings and diagnostics.

## Document preparation and Tauri/mobile path

Desktop MVP should support common user documents such as PDF and any image types the local conversion pipeline can safely normalize into a supported fax document.

The longer-term Tauri mobile experience should support a scanner-style flow:

```text
camera
  -> crop / perspective correction
  -> rotate / reorder
  -> contrast / monochrome cleanup when helpful
  -> multi-page composition
  -> PDF/fax document preview
  -> send
```

Document preparation should happen locally wherever practical. Cloud OCR, AI extraction, summarization, or document transformation is not required to fax a document and must not become a hidden data-egress dependency.

Tauri UI work coordinates with WI032. This work item must not bypass WI032's secure-storage, local-service, release, mobile-data, and Electron-retirement gates or create a fax-only shell architecture that forks the shared cockpit.

## Communication firewall and agent authority

Extend the communication firewall vocabulary so `fax` can be governed as a channel kind for agent-originated actions.

Existing decisions remain conceptually valid:

```text
block
draft_only
require_approval
allow
```

Default posture for an agent should remain draft-don't-send.

An agent request should therefore normally become:

```text
agent/application request
  -> fax draft
  -> policy/consent evaluation
  -> operator review when required
  -> explicit send authority
  -> fax submission
```

Approval must be evaluated again immediately before the external side effect when policy may have changed since draft creation.

The fax document preview visible to the operator is the artifact being approved. Re-rendering or replacing the document after approval must invalidate or rebind approval according to an explicit content identity/hash rule.

## MCP/API integration

ForgeWire is not a dependency of this work item. It may later be one consumer of the same ForgeLink MCP/API used by other agents and applications.

The existing ForgeLink Human MCP can be expanded with bounded fax tools/resources once the local fax API is stable. Candidate surface:

```text
fax.status
fax.draft.create
fax.draft.inspect
fax.send.request_approval
fax.receipt.get
fax.inbox.list
```

A general unrestricted `fax.send` tool is not part of the default agent contract. If direct agent send is later exposed, it must still pass ForgeLink communication authority, consent/purpose, classification, and side-effect controls.

MCP responses must not return:

- Telnyx credentials;
- webhook signing keys;
- arbitrary raw provider bodies;
- temporary authenticated media URLs;
- private fax document bytes unless a separately authorized resource-transfer contract explicitly requires them;
- more recipient/document metadata than the caller is allowed to observe.

Safe cross-system correlation may include a caller-supplied opaque request/run/task ID, local fax ID, normalized state, timestamps, and redacted provider correlation where policy permits.

## Relationship to ForgeWire and Fabric

This work item creates no ForgeWire, GraphRuntime, AgentRun, JobService, or Fabric requirement.

Binding boundary:

```text
ordinary human fax:
ForgeLink UI -> ForgeLink fax domain -> provider

optional agentic fax:
external agent/runtime -> ForgeLink MCP/API -> ForgeLink fax domain -> provider
```

ForgeWire may later use the MCP/API for workflows such as document preparation, approval orchestration, or waiting on a delivery outcome, but ForgeLink remains the external communication side-effect authority.

Fabric must not become:

- a Telnyx fax client;
- a Telnyx credential owner;
- a fax document database;
- the fax lifecycle state machine;
- an alternate send-authority path.

Fabric may transport already-authorized execution/correlation facts when an independent ForgeWire workflow chooses to use it. That is outside the ordinary ForgeLink fax path.

## Regulated-data and privacy coordination

Fax is commonly used for health, legal, insurance, financial, employment, and government documents. That makes WI040 directly relevant even if the first generic fax implementation does not advertise regulated-workload certification.

WI041 may implement provider-neutral fax mechanics, local human UI, Telnyx fax transport, signed webhooks, document handling, and generic retention controls without waiting for every future regulated profile.

However, the following must not be claimed complete merely because fax works technically:

- HIPAA/PHI-ready route eligibility;
- BAA-required provider enforcement;
- regulated backup/export guarantees;
- regulated notification/redaction guarantees;
- healthcare/legal/compliance certification.

When WI040 classification contracts are available, fax records, documents, notifications, agent drafts, provider routing, backups/exports, and MCP projections must consume those contracts rather than invent a fax-specific classification system.

Until then, implementation must preserve extension points and minimize sensitive data so WI040 can tighten behavior without a destructive rewrite.

## Retention and deletion

Fax payload retention must be deliberate because documents can be far more sensitive than ordinary message metadata.

The implementation must distinguish:

- active transmission document;
- inbound managed document;
- user-visible retained document;
- transient provider/webhook/media payload;
- non-payload delivery/audit evidence.

A configurable short-retention or delete-after-success mode should be supported when it can be implemented safely, but deletion must not erase required non-content evidence needed to explain that a transmission occurred and how it terminated.

Deleting a local document must have explicit semantics for:

- previews/thumbnails;
- temporary render files;
- inbound provider downloads;
- backups/exports;
- retry eligibility;
- receipts;
- audit records;
- linked drafts/approvals.

## Error and retry semantics

Fax retry behavior must be more conservative than ordinary HTTP request retry because duplicate transmission is a real side effect.

Classify failures at minimum into:

- definite local/preflight failure: provider not called;
- definite provider rejection before acceptance;
- accepted/queued with provider fax ID;
- transient status/reconciliation failure after accepted submission;
- terminal provider transmission failure;
- ambiguous submission where the provider may have accepted the request;
- cancellation requested/confirmed/too-late;
- inbound document fetch failure after a valid receive event.

Automatic retry is permitted only where duplication safety is demonstrated. Ambiguous submission should reconcile by provider identifier/idempotency mechanism when available or require operator decision rather than blindly sending again.

## Cost visibility

ForgeLink should not reproduce the subscription-heavy fax experience that motivated this work.

For the local/operator-owned Telnyx model, ForgeLink does not need an internal subscription or credit ledger simply to expose fax. The operator pays their configured provider directly.

Where Telnyx or another provider exposes reliable per-transmission cost data, ForgeLink may show:

- estimated cost before send when enough information exists;
- actual provider-reported cost after completion;
- page count and rate metadata;
- unknown when cost cannot be proven.

A future hosted consumer service, ForgeLink-managed credit system, app-store purchase model, or multi-tenant fax gateway is a separate product/business architecture and is not silently introduced by this work item.

## Implementation phases

### Phase 0 — Architecture seal and current-surface audit

Before code changes:

1. Re-read `AGENTS.md`, WI015, WI016, WI032, WI035, WI037, and WI040.
2. Inventory current channel registry, provider selection, Telnyx settings/storage, webhook queue, media storage, messages/contacts, firewall, drafts/approvals, notifications, backup/export, and shared cockpit/Tauri bridges.
3. Record which primitives can be reused unchanged, which require a generic extraction, and which are fax-specific.
4. Confirm current Telnyx Programmable Fax API/application/number/webhook requirements against live official documentation before freezing provider fields.
5. Seal the provider-neutral fax contracts, local lifecycle state machine, document identity model, and human-versus-agent authority boundary.

**Gate:** no implementation may solve fax by adding optional fields to SMS messages or by putting Telnyx fax calls into ForgeWire/Fabric.

### Phase 1 — Fax domain and persistence

Implement provider-neutral fax types, durable schema/migrations, repositories/services, state transition rules, document references, event ledger, retention hooks, and safe diagnostics.

Prove migration/rollback and restart semantics without a live provider.

### Phase 2 — Telnyx outbound fax edge

Implement Telnyx fax settings/validation, provider adapter, outbound API call, provider ID/status normalization, safe errors, reconciliation hooks, and deterministic tests.

Do not require inbound fax to declare outbound correctness complete.

### Phase 3 — Signed fax webhooks and lifecycle reconciliation

Add the dedicated fax webhook route using shared hardened Telnyx signature primitives, durable enqueue-before-ack, deduplication, occurrence ordering, state transition enforcement, restart drain, unsupported-event behavior, and bounded raw retention.

### Phase 4 — Inbound fax and durable media

Implement inbound record creation, authenticated remote document acquisition, validation/quarantine, managed local document persistence, provider-reference replacement, retention, notification, backup/export integration, and recovery.

### Phase 5 — Human UI

Add Fax navigation, New Fax, Sent, Inbox, transmission detail/receipt, Settings/readiness, preview, safe retry/cancel, deletion/retention controls, keyboard/accessibility behavior, and error remediation.

Human operation must be complete without MCP or an agent.

### Phase 6 — Agent/API/MCP governance

Add fax to the communication-firewall vocabulary and reviewed-draft lifecycle. Expose only bounded MCP/API capabilities. Prove draft-before-send, content identity/approval binding, policy re-evaluation, blocked/denied behavior, direct-send exception policy, and redacted projections.

### Phase 7 — Tauri/mobile parity

Coordinate with WI032 to expose real fax behavior through the shared Tauri bridge and mobile cockpit without duplicating the backend, secrets, database, or communications policy. Add local document/photo preparation where supported.

### Phase 8 — Regulated-data integration

Consume the WI040 classification/eligibility/retention/redaction contracts as they become available. Prove representative negative routes for sensitive documents. Do not turn this phase into a certification claim.

### Phase 9 — Live Telnyx acceptance and closeout

Run an opt-in, credential-safe live gate against designated test resources covering outbound fax, final delivery, failure, signed webhook processing, inbound reception if configured, restart/reconciliation, document retention/deletion, and UI state.

Live evidence must contain no API keys, signing keys, private fax document content, full phone numbers unless explicitly permitted, or reusable authenticated media URLs.

## Acceptance criteria

- [x] **FAX-001** Seal and document the ForgeLink-native product boundary: humans can use fax directly; external agents/applications may use governed API/MCP; ForgeWire/Fabric are not required or authoritative.
- [x] **FAX-002** Define a provider-neutral `fax_edge` capability family and specialized fax contracts without widening SMS/MMS message contracts into an ambiguous universal payload.
- [x] **FAX-003** Add durable fax transmission, document-reference, and event-ledger persistence with migrations, restart recovery, normalized lifecycle transitions, and explicit ambiguous-side-effect semantics.
- [x] **FAX-004** Add a separate Telnyx Programmable Fax configuration/validation surface and adapter while preserving separation from Telnyx messaging, voice, and ForgeWire inference configuration.
- [x] **FAX-005** Implement outbound Telnyx fax submission, provider ID/status normalization, bounded safe errors, cancellation/reconciliation where supported, and duplicate-safe retry policy.
- [x] **FAX-006** Add a dedicated signed Telnyx fax webhook route reusing hardened signature/freshness primitives while keeping fax event parsing/lifecycle separate from SMS/MMS; prove enqueue-before-ack, deduplication, ordering, restart drain, and unsupported-event handling.
- [x] **FAX-007** Implement inbound fax reception and managed local document acquisition with authenticated download, strict media/resource validation, opaque local references, quarantine/failure behavior, retention, deletion, backup/export, and recovery semantics.
- [ ] **FAX-008** Deliver a first-class human Fax UI with New Fax, preview, Sent, Inbox, receipt/detail, readiness/settings, safe retry/cancel, document open/export/delete, accessibility, and clear error remediation without any agent dependency.
- [ ] **FAX-009** Implement local document preparation sufficient for common PDFs/images and define the Tauri/mobile camera-scan path without creating hidden cloud/LLM egress requirements or a fax-specific shell fork.
- [ ] **FAX-010** Extend ForgeLink communication firewall, reviewed drafts, consent/purpose hooks, and approval content identity to fax; human operator sends remain direct while agent-originated sends default to draft-don't-send.
- [ ] **FAX-011** Expose a bounded fax API/MCP surface for status, draft creation/inspection, approval request, receipt, and inbox access with authorization/redaction; do not expose provider credentials or unrestricted direct send by default.
- [ ] **FAX-012** Integrate fax payload, notification, provider-routing, retention, backup/export, audit, and MCP behavior with WI040 regulated-communications contracts where applicable, with no unsupported legal/compliance certification claim.
- [ ] **FAX-013** Provide privacy-preserving retention/deletion controls that distinguish document payloads and temporary artifacts from minimal non-payload delivery/audit evidence and prove cleanup of previews, temporary renders, inbound downloads, and provider references.
- [ ] **FAX-014** Provide truthful page count, provider readiness, delivery state, and cost visibility where provable; unknown values remain unknown; no subscription/credit system is required for operator-owned Telnyx use.
- [ ] **FAX-015** Prove deterministic negative/error tests for invalid configuration, unsupported capability, malformed/oversized documents, invalid/stale webhook signatures, duplicate/out-of-order events, ambiguous send, cancellation races, inbound fetch failure, unauthorized agent send, sensitive-data route restrictions, and secret/content redaction.
- [ ] **FAX-016** Pass an opt-in live Telnyx end-to-end acceptance gate using designated test resources and credential-safe evidence, then complete docs, rollback, migration, known-limitation, and closeout records.

## Validation and evidence matrix

| Surface | Required proof |
| --- | --- |
| Contracts | Provider-neutral fax types/capabilities; SMS/MMS contracts remain coherent |
| Persistence | migration, rollback, restart, state legality, event identity, retention/deletion |
| Telnyx outbound | validation, accepted send, rejection, safe error, provider ID, reconciliation, retry safety |
| Webhooks | valid/invalid/stale signatures, enqueue-before-ack, duplicate, out-of-order, unknown authentic event, restart drain |
| Inbound | receive, authenticated document fetch, invalid MIME, oversized payload, timeout, quarantine, persistence, deletion |
| Human UX | new/send/preview, sent, inbox, details/receipt, settings/readiness, errors, accessibility |
| Agent governance | blocked, draft-only, approval, re-evaluation, content identity, direct-send exception, audit |
| MCP/API | capability discovery, status, draft, approval, receipt, inbox, authorization, redaction, no secrets |
| Tauri/mobile | shared bridge, secure storage boundary, no database replication shortcut, document/camera preparation posture |
| Regulated/privacy | classification propagation when available, forbidden route, notification/log/evidence redaction, retention/export behavior |
| Live Telnyx | designated test number/application only; outbound, lifecycle, inbound if configured, final evidence, no sensitive payload |

## Dependencies and coordination

### WI015 — Communication Channels and Voice

Reuse the provider-neutral channel/capability registry philosophy, contact/message integration patterns, provider selection, and communications runtime boundaries. Do not reinterpret WI015 as requiring fax to be a generic `OutboundMessage`.

### WI016 — Agent-Human Governance

Reuse communication firewall, reviewed outbox, approval, consent, authority, evidence, and redaction semantics for agent-originated fax. Do not impose the agent firewall on a normal authenticated human send.

### WI032 — Tauri Production Parity and Electron Retirement

Fax must ride the shared cockpit/Tauri path and cannot create a separate shell, secret store, local service, or mobile database architecture.

### WI035 — First-Class Telnyx Integration

Reuse the existing Telnyx provider onboarding discipline, protected secret posture, explicit validation, redacted status, and operator-facing provider truth.

### WI037 — Telnyx Production Hardening and Expansion

Reuse hardened Telnyx webhook security, durable ingestion, error/health thinking, and provider-ownership rules. Fax is split into WI041 because it introduces a new schema family, configuration/capability family, public webhook lifecycle, document retention concerns, and materially different provider semantics.

WI037's messaging/voice/RCS/Verify work remains independently owned; WI041 must not silently close or absorb those criteria.

### WI040 — Regulated Communications Data and Provider Boundary

WI040 owns classification, regulated provider/channel eligibility, regulated retention/export/redaction, and compliance-claim boundaries. WI041 consumes those contracts rather than inventing parallel fax-specific policy.

## Non-goals

This work item does not authorize:

- a separate ForgeWire-owned fax subsystem;
- Telnyx fax code or credentials in Fabric;
- requiring AgentRun/GraphRuntime for ordinary human fax use;
- turning the SMS/MMS `OutboundMessage` into a universal document/call/fax envelope;
- a hosted multi-tenant consumer fax SaaS backend;
- a ForgeLink subscription or credit/payment system;
- automatic Telnyx number purchase, porting, billing changes, or account-wide mutation without a separately governed operator flow;
- bulk unsolicited advertising fax features;
- silent automatic retry after an ambiguous external send;
- indefinite retention of raw webhook bodies, temporary provider URLs, or fax documents merely for debugging;
- storing private fax payloads in RepoPact evidence;
- claiming HIPAA, PCI DSS, SOC 2, TCPA, privacy-law, or other legal compliance from technical controls alone;
- cloud OCR, AI, or ForgeWire inference as a prerequisite for scanning or faxing a document.

## Prohibited shortcuts

Do not:

- put `sendFax()` in ForgeWire Fabric;
- make ForgeWire the fax lifecycle owner;
- store Telnyx fax credentials in a `.forge` application or MCP client;
- reuse a Telnyx messaging profile as if it were a fax connection;
- parse fax events through SMS delivery-state code merely because both come from Telnyx;
- expose provider response bodies to the renderer;
- store authenticated temporary media URLs as durable document URLs;
- retry an ambiguous fax submission as if it were an idempotent read;
- allow an agent to replace an approved document without invalidating the approval;
- claim inbound readiness without proving the actual provider webhook/document path;
- claim Tauri/mobile readiness from UI stubs without the secure local-service/provider path;
- require an LLM for a basic human communications feature.

## Completion definition

WI041 is complete only when ForgeLink can truthfully demonstrate the following end-to-end product story:

> A person opens ForgeLink, chooses **Fax**, selects or scans a document, previews the exact pages, enters a destination, sends through a configured Telnyx fax edge, closes/reopens the application if necessary, sees the transmission progress to a truthful terminal state, and can inspect a delivery receipt. If the configured number receives a fax, ForgeLink authenticates the provider event, safely acquires the document, stores it under local policy, and presents it in the Fax inbox. None of this requires ForgeWire or an agent. When an agent does request a fax, ForgeLink remains the authority, defaults to governed draft/approval behavior, and exposes only the bounded MCP/API surface the caller is authorized to use.

That is the product boundary this work item must preserve.

## Progress log

- **2026-09-10 — Phase 0 architecture preflight (partial).** Audited the
  current channel registry/capability contracts, Telnyx SMS/MMS
  adapter/settings, the `/webhooks/telnyx` signature/durable-queue boundary,
  schema/migration ladder (current version 28), the communication firewall,
  the `forgelink-human` MCP tool surface, and the Tauri bridge against
  README §"Phase 0 — Architecture seal and current-surface audit". No
  contradiction found between this README's architectural assumptions and the
  live repository; see
  [local-artifacts/phase0-architecture-preflight.md](local-artifacts/phase0-architecture-preflight.md)
  for the full findings and exact insertion points. Not yet done: re-checking
  live Telnyx Programmable Fax API/webhook documentation (deferred to the
  start of implementation so it is fresh when frozen into code), and any
  schema/contract/code changes (Phase 1 onward). No acceptance criteria are
  satisfied by this preflight; all FAX-* criteria remain pending.

- **2026-09-11 — Phase 1: provider-neutral fax domain and durable persistence
  (FAX-002, FAX-003 satisfied).** Implemented, with no Telnyx network calls
  anywhere in this slice:
  - **Provider-neutral contracts** (`Electron/backend/src/fax.ts`, new):
    `FaxDirection`, `FaxProvenance`, `FaxState`, `FaxDocumentRef`,
    `FaxRequest`, `FaxResult`, `FaxStatusUpdate`, `InboundFax`, and a
    `FaxProvider` interface that is deliberately *not* a `ChannelAdapter` (it
    does not implement `send(OutboundMessage)`, and no `ChannelAdapter` was
    made to implement fax methods), so the SMS/MMS/voice contract stays
    uncontaminated. `channels.ts` gained the `fax_edge` `ChannelKind` and the
    `fax_send` / `fax_receive` / `fax_status` / `fax_cancel` / `fax_media`
    capabilities for discovery/UI parity only; `OutboundMessage` was not
    widened.
  - **Sealed lifecycle state machine** (`fax.ts`): 14 states covering both
    directions (`draft` → `prepared` → `submission_pending` → `submitting` →
    `accepted` → `sending` → `delivered`, with `ambiguous` as the durable
    "provider outcome unknown after a network failure" state reachable only
    from `submitting`, and `cancel_pending` → `cancelled` as a distinct
    branch that can still race to `delivered`/`failed`; inbound:
    `receiving` → `processing` → `received`). `classifyFaxTransition` is a
    pure function returning `applied` / `duplicate` / `illegal`, so later
    webhook normalization (Phase 3) can apply events by state precedence
    rather than trusting arrival order.
  - **Durable persistence** (`database.ts`, schema v28 → v29): `faxes`
    (transmission-lifecycle authority), `fax_documents` (managed local
    document references — never provider URLs/bytes, never message rows),
    and `fax_events` (provider-neutral event ledger, dedup-by-`event_id`,
    mirroring the `telnyx_webhook_events` pattern proven at v28). New
    `PhoneDatabase` methods: `createFax` (idempotent on `local_fax_id`),
    `faxByLocalId`, `faxByProviderFaxId`, `faxes`, `pendingFaxes`,
    `applyFaxState` (the state-machine-guarded transition — the idempotency
    seam: a duplicate `submission_pending` request is rejected, not
    reapplied), `createFaxDocument`, `faxDocumentsByFaxId`, `recordFaxEvent`
    (dedupes by event id, then applies through `applyFaxState`),
    `pendingFaxEvents`, `completeFaxEvent`.
  - **Idempotency model:** ForgeLink's own `local_fax_id` is the durable
    outbound-operation identity (not Telnyx's `command_id`, which Phase 2 may
    use only as an *additional* bounded protection). Creating a fax twice
    with the same `local_fax_id` is a no-op; re-entering `submission_pending`
    on an already-`submission_pending` fax is rejected as a duplicate
    transition — the seam that prevents a retried "begin submission" call
    from racing a second real Telnyx transmission once Phase 2 lands.
  - **Tests:** `fax.test.ts` (8 tests, pure state-machine legality/precedence)
    and 11 new tests in `database.test.ts` covering fresh schema, v28→v29
    migration with pre-existing data preserved, forward-version rejection,
    create/reload, document linkage, direction round-trip, legal/illegal/
    terminal transitions, event dedup and out-of-order-event non-regression,
    creation/submission idempotency, and the ambiguous-state round-trip. Full
    suite: `cd Electron && npm test` — 261 tests, 260 passed, 1 skipped
    (opt-in live Twilio test, unaffected), 0 failed; `npm run backend:build`
    and `npm run renderer:build` both pass. **No Telnyx network call occurred
    at any point in this phase.**
  - **Limitations / explicitly not done:** the Telnyx Programmable Fax
    adapter, credential validation, Fax Application/`connection_id`
    provisioning, the `/webhooks/telnyx/fax` route, provider media
    upload/download, any public HTTP endpoint for fax, UI, camera scan, OCR,
    cover-page rendering, MCP fax tools, communication-firewall fax draft
    flow, and Tauri secret storage are all out of scope for this phase and
    remain unimplemented. FAX-001 and FAX-004 through FAX-016 remain pending.
  - Evidence: `evidence/runs/20260911-fax-phase1-domain-and-persistence.json`.

- **2026-09-10 — Phase 1.1: hardening correction following architectural
  review (FAX-002, FAX-003 reopened, then re-satisfied).** An architectural
  review of the Phase 1 commit found seven issues; all seven are corrected in
  this slice, with no Telnyx network call, credential, or provider side
  effect at any point.
  - **Why FAX-002/FAX-003 were reopened:** FAX-002 claims the specialized
    contracts are provider-neutral, but `FaxRequest.clientState` leaked
    Telnyx's `client_state` transport parameter into the neutral domain
    (finding 4). FAX-003 claims normalized lifecycle and restart/recovery
    semantics, but `createFax()` hardcoded `state='draft'` for every
    direction, so an inbound fax began in an outbound-only state it could
    never legally leave (finding 1), and out-of-order/duplicated provider
    observations were checked against the same strict single-edge adjacency
    used for local commands, which is correct for commands but insufficient
    for provider observations that may skip stages (finding 2). Both
    criteria were returned to `pending`; the original Phase 1 evidence
    (`20260911-fax-phase1-domain-and-persistence`) is retained as historical
    evidence of what Phase 1 actually did, not deleted.
  - **Finding 1 (direction-aware initialization), fixed:** `FAX_INITIAL_STATE`
    maps `outbound -> draft`, `inbound -> receiving`. The legal-transition
    graph is now split per direction
    (`FAX_LEGAL_TRANSITIONS_OUTBOUND`/`_INBOUND`) with a
    `faxStateBelongsToDirection` guard, so an outbound record cannot reach an
    inbound state (or vice versa) as a structural lookup miss, not merely
    because nobody happened to add that edge.
  - **Finding 2 (command vs. observation), fixed:** split
    `classifyFaxCommandTransition` (strict, single-edge, for local
    operator/system commands: draft → prepared, the atomic submission claim,
    a cancel request) from a new `reconcileFaxObservation` (monotonic,
    direction-aware, skip-ahead-safe via precomputed transitive reachability
    over the same direction-scoped graph, for provider observations). A fax
    `accepted` that observes `delivered` directly now correctly converges;
    a `sending` fax that later observes a stale `accepted` does not regress;
    `ambiguous` can reconcile straight to any later authoritative outcome
    without requiring every missing intermediate webhook; a `cancel_pending`
    race still converges to an authoritative `delivered`/`failed`/`cancelled`.
    Every valid provider event is still durably recorded (for evidence/
    dedup) even when it does not move the fax's state.
  - **Finding 3 (ledger vs. ingress queue), clarified:** corrected comments
    and this README's language wherever Phase 1 conflated `fax_events` (the
    provider-neutral *normalized* event ledger, linked to a local fax id)
    with the future Telnyx public webhook *ingress* queue (provider-specific,
    signature-verified, enqueued before a local fax may even exist yet —
    still FAX-006, still not built). No ingress queue was added in this
    phase; only the distinction was corrected.
  - **Finding 4 (Telnyx leakage), fixed:** removed `FaxRequest.clientState`.
    `correlation`/`localFaxId` remain the neutral concepts; a future Telnyx
    adapter derives its own `client_state` from them. Audited the rest of
    `fax.ts` for similar leakage — none found (`quality` stays a plain
    string; Telnyx's `normal`/`high`/`very_high`/`ultra_light`/`ultra_dark`
    enum belongs in the Telnyx adapter/configuration layer, not here).
  - **Finding 5 (provider-scoped identity), fixed:** schema v30 (decision
    0011 row added) rescopes `faxes.provider_fax_id` from a bare column
    `UNIQUE` to a partial unique index on `(provider, provider_fax_id)`, and
    `fax_events` gains a `provider` column with primary key
    `(provider, event_id)` instead of `event_id` alone. The migration copies
    all three fax tables' existing rows to temp tables, drops children before
    the parent (`fax_events`, `fax_documents`, then `faxes` — the order that
    avoids `ON DELETE CASCADE` silently wiping `fax_documents` when the
    referenced `faxes` table is dropped, confirmed by direct experiment
    during this work), recreates all three, and restores the data in
    parent-then-child order. The v29 migration step itself is untouched.
    `faxByProviderFaxId`/`completeFaxEvent` are now provider-scoped calls.
  - **Finding 6 (idempotency vs. conflict), fixed:** `createFax` now
    distinguishes a true retry (identical `local_fax_id` **and** identical
    immutable identity — direction/to/from) from an operation-key collision
    (same id, different identity), which now throws
    `FaxIdentityConflictError` and creates nothing rather than silently
    succeeding. `applyFaxState`/the new `applyFaxObservation` use an explicit
    expected-state conditional `UPDATE ... WHERE local_fax_id=? AND state=?`
    (a compare-and-swap) rather than an unconditional write after a prior
    read; a dedicated test attempts the identical conditional-update pattern
    with a deliberately stale expected state and proves zero rows change.
  - **Finding 7 (`FaxStatusUpdate.terminal`), fixed:** removed the field.
    Terminality is fully derived from `normalizedState` via
    `isFaxTerminalState`; ForgeLink's lifecycle, not a provider adapter,
    remains the sole authority on what counts as terminal.
  - **Evidence-date correction:** the Phase 1 evidence record and WI041's
    `updated` field both incorrectly stated 2026-09-11; the actual Phase 1
    commit (`044aa6a527475ab7567cae093126b91cf72b5aad`) was made
    2026-09-10T21:33:37Z. Both are corrected to the accurate date; the
    original values remain visible in git history at that commit, per
    `evidence/runs/20260911-fax-phase1-domain-and-persistence.json`'s
    `environment.date_correction` field.
  - **Tests:** 20 new/rewritten tests across `fax.test.ts` and
    `database.test.ts` (92 total in the focused fax/database/channels run,
    up from 72), covering every case in this correction's required list,
    including a restart (close/reopen `PhoneDatabase`) proof for the
    ambiguous-then-reconciled path. Full suite: 281 tests, 280 passed, 1
    skipped (opt-in live Twilio, unrelated), 0 failed, confirmed on a clean
    re-run after one transient, unrelated vitest timeout (`LAN-006`, a
    pre-existing renderer test this change never touches) was isolated and
    reproduced as passing on its own.
  - **No Telnyx provider send occurred. No Telnyx credentials were used. No
    live provider side effect occurred.**
  - Evidence: `evidence/runs/20260910-fax-phase1-1-hardening-correction.json`
    (together with the retained original,
    `evidence/runs/20260911-fax-phase1-domain-and-persistence.json`).

- **2026-09-10 — Phase 2: Telnyx Programmable Fax outbound edge (FAX-001,
  FAX-004, FAX-005 satisfied).** Current official Telnyx documentation was
  rechecked against the authoritative OpenAPI spec and frozen in
  [local-artifacts/phase2-telnyx-fax-contract.md](local-artifacts/phase2-telnyx-fax-contract.md);
  see that document for full source URLs and the exact schemas relied on. No
  live Telnyx network call, credential, or provider side effect occurred at
  any point in this phase.
  - **`command_id` resolved:** not present in either `POST /v2/faxes` request
    schema (JSON or multipart), despite prose documentation mentioning it.
    Not sent. ForgeLink's own `local_fax_id` and the atomic CAS claim remain
    the sole durable idempotency authority, unchanged.
  - **Media mode resolved:** no public URL-serving mechanism exists in
    ForgeLink and none was built. `media_name` requires Telnyx Media Storage
    (not integrated). The confirmed, currently-supported `multipart/
    form-data` `contents` upload is implemented as the production resolver
    (`createLocalFileFaxDocumentResolver`, reading the same `<dataDir>/
    uploads/` convention already used for MMS media) — a real, tested,
    production-capable path, not a stub. `media_url` is also implemented and
    is what deterministic tests use by default. **Known limitation:** the
    multipart schema has no `client_state` field, so a contents-mode send
    cannot carry the opaque provider correlation token; see the frozen
    contract document for the narrow consequence (an ambiguous contents-mode
    send with no captured provider fax ID cannot resolve via webhook
    `client_state` in Phase 3).
  - **Configuration ownership** (`Electron/telnyxFaxSettings.js`, new):
    OS-encrypted via `safeStorage`, a fully separate settings file and
    `TELNYX_FAX_*` env var family from SMS/MMS's `TELNYX_*`/
    `TELNYX_MESSAGING_PROFILE_ID`. `connection_id` (Fax Application ID) is
    validated as a bounded printable string, not assumed to be a UUID
    (Telnyx's own schema types it `IntId`, e.g. `"1293384261075731499"`).
  - **Read-only readiness validation** (`validateTelnyxFaxSettings` in the
    settings module; `validateTelnyxFaxConfig` in the backend adapter, for
    the two separate runtime contexts, mirroring the existing SMS pattern):
    GET-only, never mutates Telnyx. Separates `configured` /
    `outbound_ready` (requires the Fax Application to have an Outbound Voice
    Profile attached — a retrievable Fax Application alone does not prove
    outbound readiness) / `inbound_webhook_ready` (bookkeeping only; the
    actual webhook route is Phase 3).
  - **`TelnyxFaxProvider`** (`Electron/backend/src/telnyx-fax.ts`, new,
    entirely separate from `telnyx.ts`): implements `FaxProvider`.
    Capabilities advertised: `fax_send`, `fax_status`, `fax_cancel` only —
    not `fax_receive` (inbound is unimplemented) and no standalone media
    capability. Telnyx's own status strings never leave this file; the
    frozen mapping (`mapTelnyxFaxStatus`) collapses `queued`/
    `media.processed` → `accepted`, `originated`/`sending` → `sending`,
    `delivered`/`failed` unchanged, with the equivalent inbound mapping
    defined for completeness. An unrecognized status maps to `null` (no
    mutation, fail safe).
  - **Error classification** (`FaxProviderPreflightError` /
    `FaxProviderRejectionError` / `FaxProviderAmbiguousError`, added to the
    provider-neutral `fax.ts` since the taxonomy is part of the `FaxProvider`
    contract, not Telnyx-specific): a network/timeout failure, a 5xx, a `202`
    with no usable fax id, and any unrecognized status all become
    `FaxProviderAmbiguousError` — never automatically retried. Only an
    explicit, documented Telnyx rejection response becomes
    `FaxProviderRejectionError`. A missing document/config before any
    network call becomes `FaxProviderPreflightError`. No raw Telnyx response
    body, error detail string, or API key ever appears in an error message.
  - **`FaxSubmissionService`** (`Electron/backend/src/fax-submission.ts`,
    new): the single ForgeLink-owned orchestration boundary. `submitFax`
    performs the atomic `submission_pending -> submitting` CAS claim (Phase
    1.1's expected-state conditional `UPDATE`) before ever calling the
    provider; only the winning caller invokes `sendFax`. Generates and
    durably persists an opaque provider correlation token (locally random,
    non-sensitive, no phone numbers/filenames/names/hashes) before the
    network call, via a new schema column (below). A `202` accepted result
    with no usable provider id is still treated as ambiguous, defensively,
    even though the provider layer already guards this. `reconcileFax`
    (`GET`) and `requestFaxCancellation` (cancel command) round out the
    orchestration surface, both routing every provider observation through
    Phase 1.1's `applyFaxObservation` (never the strict command path).
  - **Cancellation — known limitation:** Telnyx's cancel command (`POST
    /faxes/{id}/actions/cancel`) returns `202 {data:{result:"ok"}}` with no
    fax status, and Telnyx's own fax `status` enum has no `cancelled` value.
    A successful cancel command therefore only claims local `cancel_pending`
    — it never fabricates a `cancelled` state Telnyx does not actually
    provide. The true outcome (the transmission actually stopped, or it won
    the race to `delivered`/`failed`) requires a later `GET`/observation.
    FAX-005 is satisfied for correctly-modeled, non-overclaiming cancel
    request construction and local state — not for a Telnyx-confirmed
    terminal cancellation, which no Telnyx API inspected here currently
    proves.
  - **Schema:** v31 (decision 0011 row added) — additive
    `faxes.provider_correlation_token TEXT` with a partial unique index; no
    table recreation needed. The v30 migration step is untouched.
  - **Tests:** 48 new (11 settings-store, 22 adapter, 15 orchestration) plus
    3 new/updated migration tests and one pre-existing test's fixture
    corrected for the new column (166 in the focused fax/database/channels/
    telnyx run, up from 92). Full suite: 330 tests, 329 passed, 1 skipped
    (opt-in live Twilio, unrelated), 0 failed; `npm run backend:build`,
    `npm run renderer:build`, and vitest (228 cases) all pass.
  - **No live fax was sent. No operator Telnyx credential was used. No live
    Telnyx resource was mutated. FAX-016 was not attempted.**
  - Not implemented (unchanged scope boundary): the public fax webhook
    route/ingress queue, inbound reception, the human Fax UI, MCP fax tools,
    the communication-firewall fax draft flow, Tauri secret-storage parity,
    camera scanning, OCR, cover-page rendering, and the live acceptance
    gate. FAX-006 through FAX-016 remain pending.
  - Evidence: `evidence/runs/20260910-fax-phase2-telnyx-outbound-edge.json`.

- **2026-09-10 — Phase 2.1: outbound-edge hardening correction following
  architectural review (FAX-005 reopened, then re-satisfied).** No live
  Telnyx network call, credential, or provider side effect at any point.
  - **Why FAX-005 was reopened:** the review found the cancellation claim
    could leave a fax falsely in `cancel_pending` (entered unconditionally,
    even with no provider fax id, no provider `cancelFax` support, or after
    an explicit Telnyx rejection), and that reconciliation could not verify
    provider-observed direction against the local fax's own direction
    before mutating it -- a real gap, since `failed` is legal in both the
    outbound and inbound graphs. Both are genuine FAX-005 correctness
    defects, not cosmetic ones. The original Phase 2 evidence
    (`20260910-fax-phase2-telnyx-outbound-edge`) is retained as historical
    evidence of what Phase 2 actually did, not deleted.
  - **Finding 1 (false `cancel_pending`), fixed:** `requestFaxCancellation`
    no longer claims `cancel_pending` unconditionally. No provider fax id or
    no provider `cancelFax` support now returns `"unsupported"` without any
    state mutation. An accepted (`202`) or ambiguous (network/5xx/timeout)
    provider outcome leaves the fax `cancel_pending` (`"claimed"`/
    `"ambiguous"` respectively -- acceptance cannot be excluded in the
    ambiguous case). An explicit rejection (`404`/`422`) rolls the claim
    back to the fax's prior state via a new dedicated database method,
    `restoreCancelClaim(localFaxId, priorState)`, scoped to
    `WHERE state = cancel_pending` -- never added as a general
    reconciliation-graph edge, so ordinary provider-observation monotonicity
    is unweakened. If a provider observation races the rejection and has
    already advanced the fax to a terminal state, the rollback is a
    harmless no-op (proven by a dedicated test). The atomic claim itself
    (still the sole concurrency guard against two cancel commands) is
    unchanged.
  - **Finding 2 (lost provider direction), fixed:** `FaxStatusUpdate` now
    carries an explicit, required `direction` field.
    `TelnyxFaxProvider.getFax` no longer defaults an unrecognized Telnyx
    `direction` to `"outbound"` -- a missing/malformed value is a bounded
    `FaxProviderAmbiguousError("malformed_direction", ...)`.
    `FaxSubmissionService.reconcileFax` now compares the provider's reported
    direction against the local fax's own direction *before* calling
    `applyFaxObservation` at all, returning `"direction_mismatch"` (no
    mutation) rather than trusting state-shape compatibility as an implicit
    direction check.
  - **Finding 3 (contradictory `ok: true` on unready outbound), fixed:**
    `TelnyxFaxProvider.validateCredentials()` now reports `ok: false` when
    `outbound_ready` is false, even though the configuration itself resolves
    cleanly (e.g. no Outbound Voice Profile attached) -- richer readiness
    (`configured`/`outbound_ready`/`inbound_webhook_ready`) remains
    available separately for settings/status UI via
    `validateTelnyxFaxConfig`. `sendFax` also now fails closed with
    `missing_from_number` before any network attempt when neither the
    request nor the configuration supplies a sending number.
  - **Finding 4 (unvalidated document at the provider boundary), fixed:**
    the production local-file resolver now enforces, before any network
    call: basename-only `local_ref` plus `fs.realpath`-based containment
    under the uploads directory (rejecting symlink/reparse-point escape,
    proven where creatable on this platform); a `fs.stat`-based size check
    against the documented 20MB limit *before* any full read; a supported-
    format extension allow-list; content-type/extension agreement (fails
    closed on a top-level media-type mismatch); and, when
    `fax_documents.content_sha256` is non-empty, a SHA-256 verification of
    the bytes actually read.
  - **Finding 5 (pre-network failures misclassified as ambiguous), fixed:**
    `sendFax` now separates building the request (JSON body or
    `FormData`/`Blob` construction) from invoking `fetch()`; only a failure
    of the network call itself becomes `FaxProviderAmbiguousError`.
    `FaxSubmissionService.submitFax` now checks the return value of
    `setFaxProviderCorrelationToken` -- a persistence failure produces a
    definite `failed` outcome and the provider is never called.
  - **Finding 6 (401/429 classification), resolved:** recorded in the
    frozen contract that `401` (authentication failure) and `429` (rate
    limited) are definite rejections -- Telnyx never begins processing
    either -- and added both to `telnyx-fax.ts`'s rejection set. Automatic
    retry remains prohibited regardless.
  - **Preserved unchanged** (no concrete contradiction found): `FaxProvider`
    stays separate from `ChannelAdapter`; Telnyx Fax settings stay separate
    from SMS/MMS; `TELNYX_FAX_*` stays a separate env family; the CAS
    submission claim remains the durable send authority; no `command_id` is
    sent; the provider correlation token remains non-sensitive; multipart
    `contents` remains the production media transport; `client_state`
    remains JSON-mode only; no automatic resend of `ambiguous`; a `202`
    still requires a usable provider fax id; cancel `202` still never
    fabricates terminal `cancelled`; provider raw bodies still never escape
    the adapter; Telnyx status strings still stay inside the adapter.
  - **Schema:** unchanged (still v31) -- this correction needed no new
    persisted column.
  - **Tests:** 27 new/updated (13 in `telnyx-fax.test.ts`: readiness
    gating x3, missing-from-number preflight x2, request-construction
    failure, 401/429, direction handling x3, media hardening x6; 14 in
    `fax-submission.test.ts`: cancellation unsupported/ambiguous/rejected+
    rollback/rollback-race-safety/duplicate-caller x7, direction-mismatch
    reconciliation x3, correlation-token-persistence-failure x1, plus 3
    pre-existing `getFax` mocks updated for the new required `direction`
    field). 187 total in the focused fax/database/channels/telnyx/settings
    run (up from 166 at the end of Phase 2). Full suite: 358 tests, 357 passed, 1 skipped (opt-in
    live Twilio, unrelated), 0 failed; `npm run backend:build`,
    `npm run renderer:build`, and vitest (228 cases) all pass.
  - **No live fax was sent. No operator Telnyx credential was used. No live
    Telnyx resource was mutated. FAX-016 was not attempted.**
  - Evidence: `evidence/runs/20260910-fax-phase2-1-outbound-hardening-correction.json`
    (together with the retained original,
    `evidence/runs/20260910-fax-phase2-telnyx-outbound-edge.json`).

- **2026-09-10 — Phase 3: signed Telnyx Fax webhook ingress and durable
  lifecycle reconciliation (FAX-006 satisfied).** Implemented, with no
  Telnyx network call and no live Telnyx resource mutated anywhere in this
  slice:
  - **Dedicated webhook route** (`POST /webhooks/telnyx/fax` in
    `server.ts`): separate from the existing SMS/MMS `/webhooks/telnyx`
    route, reusing only the genuinely shared `verifyTelnyxWebhook` Ed25519
    primitive and the existing five-minute freshness window, but signed
    with the Fax configuration family's own key
    (`loadTelnyxFaxConfig().publicKey` / `TELNYX_FAX_PUBLIC_KEY`) with
    **no fallback** to the SMS/MMS `TELNYX_PUBLIC_KEY` -- proven by a
    dedicated test that signs a fax event with a different keypair and
    confirms rejection. Exact processing order: bounded raw body (64KB) ->
    signature/timestamp headers -> Ed25519 + freshness verification ->
    JSON parse -> bounded envelope validation
    (`parseTelnyxFaxWebhookEnvelope`, new `telnyx-fax-webhook.ts`) ->
    durable enqueue -> HTTP acknowledgement. Invalid signature, stale
    timestamp, and malformed-but-authentic body all fail closed before any
    enqueue; a database/enqueue failure returns a non-success status so
    Telnyx retries; only a successful durable enqueue (new or an idempotent
    duplicate) is acknowledged, and acknowledgement never waits for the
    event to actually be applied to a fax.
  - **Durable ingress queue** (`telnyx_fax_webhook_events`, schema v32,
    additive migration): provider-specific, distinct from both the SMS/MMS
    ingress table and the provider-neutral `fax_events` ledger, and stores
    only bounded extracted fields (event id/type, occurred/received/signed
    timestamps, attempt, provider fax id, direction, client_state, page
    count, failure category, a *transient* media URL, a hashed delivery
    target, and a payload hash) -- never a raw payload,
    never `internal_failure_reason`. `processing_status` has six values
    (`pending`/`unresolved`/`deferred_inbound`/`unsupported`/`resolved`/
    `failed`); `unresolved` and `deferred_inbound` are deliberately excluded
    from the immediate drain trigger (only the one-time startup sweep and an
    explicit post-binding re-trigger touch `unresolved`) so neither can ever
    become a hot loop.
  - **Event allow-list and normalization** (`telnyx-fax-webhook.ts`), rechecked
    against current Telnyx developer docs (see
    `local-artifacts/phase3-telnyx-fax-webhook-contract.md`): outbound
    `fax.queued`/`fax.media.processed` -> `accepted`,
    `fax.sending.started` -> `sending`, `fax.delivered` -> `delivered`,
    `fax.failed` -> `failed` (either direction); inbound
    `fax.receiving.started`, `fax.media.processing.started`, `fax.received`
    recognized but never mapped to a mutation in this phase. An authentic
    event outside this allow-list is durably classified `"unsupported"` and
    acknowledged, never guessed into lifecycle state. `failure_reason` is
    mapped through the same customer-safe allow-list Phase 2 extracted from
    the `Fax` resource schema; any unlisted value (including a genuinely new
    future Telnyx category) becomes the generic `"unknown"` category, and
    `internal_failure_reason` is never read anywhere in this module.
    Discovered this phase: Telnyx documents `fax.received`'s `media_url` as
    a signed link valid for only about ten minutes, confirming the
    mission's short-lived-retention requirement is a real provider
    constraint, not a defensive guess.
  - **Provider identity binding (Phase 3 prerequisite):** two new
    independent, write-once database primitives, `bindFaxProvider` and
    `bindFaxProviderIdentity`, decoupled from lifecycle-state CAS.
    `FaxSubmissionService.submitFax` now binds the fax to the invoking
    provider *before* ever calling it (an already-differently-bound fax
    fails closed with no provider call), and binds the returned provider
    fax id independently of whatever lifecycle state a racing webhook may
    have already advanced the fax to, so the provider identity itself can
    never be lost to that race; a genuine identity conflict resolves to
    `"ambiguous"` rather than silently overwriting either fax's binding.
    `submitFax` also gained a `state` field on its `"accepted"` outcome and
    an optional `onProviderFaxIdBound` hook, and now returns the fax's
    truthful current state (which may be further along than "accepted" if
    a webhook raced ahead of the HTTP response) instead of an assumed one.
  - **Correlation resolution order** (`telnyx-fax-webhook.ts`): (1) direct
    `(provider, provider_fax_id)` lookup; (2) a valid `client_state`
    correlation token, decoded and bounds-checked as untrusted content
    despite the signed envelope (canonical base64, decodes to ForgeLink's
    own opaque token shape, never logged if invalid) even when it resolves;
    (3) otherwise the event stays durably `"unresolved"` -- never
    heuristic-matched on recipient/sender/timestamp/page-count/filename/
    document hash. The known multipart-`client_state` gap Phase 2 recorded
    is unchanged, not newly introduced.
  - **Race convergence, proven deterministically:** a webhook arriving
    before `submitFax`'s POST response resolves immediately once
    `onProviderFaxIdBound` fires (no restart needed); a webhook arriving
    after the POST response has already bound the identity resolves
    directly with no special-casing; and, absent the hook (e.g. an actual
    restart), the startup recovery sweep still resolves it. Separately, two
    concurrent forward provider observations (e.g. one webhook reporting
    `sending`, another reporting `delivered`) both converge correctly to
    the more-advanced state, neither lost.
  - **`applyFaxObservation` hardened** (`database.ts`): now returns the
    richer `FaxObservationOutcome` (`"advanced"`/`"duplicate"`/`"stale"`/
    `"illegal"`) instead of a boolean, with a bounded (3-attempt) re-read/
    reclassify loop guarding a same-process CAS miss -- provably
    unreachable in this codebase's synchronous-SQLite architecture today,
    but kept as cheap, harmless, future-proofing defense-in-depth per the
    mission's explicit allowance, and never overclaims a write that did not
    happen. Fixed a latent bug this change would otherwise have introduced:
    `reconcileFax` and `recordFaxEvent` were still doing a truthy-check on
    this return value, which would have silently misreported every
    `"duplicate"`/`"stale"`/`"illegal"` outcome as `"advanced"` -- caught
    and fixed via code review before any test ran.
  - **Out-of-order and duplicate handling:** every resolved event applies
    through Phase 1.1's monotonic `applyFaxObservation`, so an
    older event arriving late never regresses an already-advanced state,
    while still being durably recorded for evidence/dedup. Ingress-queue
    dedup (`event_id`) and ledger dedup (`(provider, event_id)` in
    `fax_events`) are separate, independently-tested defenses.
  - **Inbound deferral boundary (Phase 3/Phase 4):** every inbound event
    type is authenticated and durably enqueued, then classified
    `"deferred_inbound"` with zero local fax lookup, creation, or mutation
    of any kind. FAX-007 is explicitly **not** satisfied by this phase.
  - **Schema:** v31 -> v32 (additive; `telnyx_fax_webhook_events` only,
    proven to preserve existing fax rows/documents/events across the
    migration). Recorded in `decisions/0011-schema-migration-coordination.md`.
  - **Tests:** 66 new (4 in `database.ts`'s FAX-006 suite: bind/identity-bind
    outcomes, `applyFaxObservation`'s richer outcome type, and the ingress
    queue's enqueue/dedupe/pending-vs-unresolved-drain behavior; 23 in the
    new `telnyx-fax-webhook.test.ts`: allow-list/normalization, failure-reason
    redaction, envelope parsing/bounding, client_state correlation
    valid/invalid, direct/correlation resolution, unsupported/invalid-
    direction/direction-mismatch/inbound-deferral handling, duplicate/
    out-of-order/concurrent-forward-observation convergence, and an
    internal-processing-error path; 9 in `fax-submission.test.ts`: provider
    mismatch fail-closed, provider binding before send, identity conflict
    after send, the `onProviderFaxIdBound` hook, and the three race-
    convergence scenarios; 1 new HTTP-level test in `server.test.ts`
    exercising the whole route -- missing/bad/wrong-key signature, stale
    timestamp, malformed/incomplete/oversized body, enqueue-before-ack,
    duplicate-id idempotent ack, unsupported-event ack, and confirming zero
    SMS/MMS-table contamination; plus a new v31->v32 migration test in
    `database.test.ts`). 244 total in the focused
    fax/database/channels/telnyx/telnyx-fax-webhook/fax-submission/server
    run. Full suite: 394 node:test cases, 393 passed, 1 skipped (opt-in
    live Twilio, unrelated), 0 failed; `npm run backend:build`,
    `npm run renderer:build`, and vitest (228 cases) all pass;
    `python .local/validate_system.py` passes.
  - **No live fax was sent. No operator Telnyx credential was used. No live
    Telnyx resource was mutated. No inbound provider document was
    downloaded. FAX-016 was not attempted.**
  - Evidence: `evidence/runs/20260910-fax-phase3-telnyx-fax-webhook-ingress.json`.

- **2026-09-10 — Phase 3.1: webhook correctness and retention hardening
  correction (FAX-006 reopened and re-satisfied), schema v32 → v33.**
  Following a GPT-5.6 Sol High review of the actual Phase 3 implementation
  (not merely the contract document), five issues were found and fixed:
  - **Finding 1 (inbound `fax.failed` routed through outbound resolution),
    fixed:** `isTelnyxFaxInboundEventType()` never listed `fax.failed`
    (correctly -- it is not inbound-*only*), but
    `processTelnyxFaxWebhookEvent()` routed on that same set alone rather
    than on the envelope's own validated `direction`, so an authentic
    inbound `fax.failed` event incorrectly fell through into outbound
    local-fax resolution instead of `deferred_inbound`. Fixed with an
    explicit event-type/direction compatibility classifier
    (`telnyxFaxEventDirectionScope`/`isTelnyxFaxEventDirectionCompatible`
    in `telnyx-fax-webhook.ts`): every supported event type is
    outbound-only, inbound-only, or shared (`fax.failed` is the only
    shared type), and routing compares that scope against the row's
    validated direction *before* any local fax lookup. A mismatched
    pairing (e.g. an outbound-only type claiming inbound direction) now
    fails closed as `event_direction_mismatch` with zero local lookup in
    either direction. The original test that exercised the local
    `direction_mismatch` guard using an inbound `fax.failed` event was
    replaced with tests matching the corrected semantics (inbound
    `fax.failed` deferred with zero lookup even when its
    `provider_fax_id` matches an existing outbound fax; the local guard
    itself retested with an outbound-routable event pointed at a local
    fax of the wrong direction).
  - **Finding 2 (failure category and page count dropped at the ledger
    handoff), fixed:** `parseTelnyxFaxWebhookEnvelope` and the ingress
    queue already carried the bounded `failure_category`/`page_count`
    correctly, but `processTelnyxFaxWebhookEvent` never forwarded either
    into `recordFaxEvent`, which itself hardcoded an empty
    `failure_category` into the `fax_events` insert and never called
    `applyFaxObservation` with either field. `FaxEventInput` gained
    optional `failure_category`/`page_count`; both now flow through to
    the canonical `faxes` record and the `fax_events` ledger row, with a
    non-failure observation's category always explicitly `''` (clearing,
    never preserving, a stale prior category) and a stale/non-advancing
    observation never reaching the write path at all (so it can never
    overwrite the authoritative state, page count, or category, while
    still being durably ledgered for evidence). `internal_failure_reason`
    remains unread throughout.
  - **Finding 3 (no retention bound on the transient inbound media URL),
    fixed:** added schema v33's additive
    `telnyx_fax_webhook_events.transient_media_expires_at` column,
    computed conservatively from the event's own `occurred_at` plus a
    cited `TELNYX_FAX_TRANSIENT_MEDIA_URL_VALIDITY_MS` constant (~10
    minutes, per Telnyx's own `fax.received` documentation), and a new
    `clearExpiredTelnyxFaxTransientMedia(now)` database method that
    clears only the URL/expiry pair on expired rows -- never the rest of
    the ingress record, never any fax/document table -- run once at
    backend startup.
  - **Finding 4 (restart sweep only ever visited the first 100 unresolved
    rows), fixed:** added a cursor-paginated
    `unresolvedTelnyxFaxWebhookEventsPage(afterRowId, limit)` using
    SQLite's own implicit `rowid` as a stable cursor; `server.ts`'s
    `drainUnresolvedTelnyxFaxWebhookEvents` now walks the entire backlog
    in a bounded one-pass loop (cursor advances past every row visited,
    resolved or not), never re-querying the same page and never becoming
    a continuous poll.
  - **Finding 5 (evidence timestamp claimed UTC but was local clock time),
    fixed:** corrected
    `evidence/runs/20260910-fax-phase3-telnyx-fax-webhook-ingress.json`'s
    `timestamp` from `2026-09-10T20:30:00Z` to the Phase 3 commit's actual
    UTC timestamp, `2026-09-11T01:05:28Z` (commit `7e65d20`), with an
    explicit `date_correction` note preserving the original error --
    mirroring the precedent set by the Phase 1 evidence date correction.
  - **FAX-006 reopen/re-satisfy:** reopened for this review (the inbound
    `fax.failed` routing bug meant the claim that the fax-specific event
    parser/lifecycle correctly handles the frozen event contract was not
    fully true), and re-satisfied by this correction together with the
    original Phase 3 evidence, both retained per the ledger's
    evidence-preservation rule. FAX-001 through FAX-005 are unaffected;
    FAX-007, FAX-009, FAX-015, and FAX-016 remain pending and untouched --
    no inbound document download, camera scanning, cloud acquisition, Fax
    UI, MCP fax tools, agent governance, or Tauri parity work was
    attempted.
  - **Schema:** v32 -> v33 (additive; `transient_media_expires_at` only).
    Recorded in `decisions/0011-schema-migration-coordination.md`.
  - **Tests:** 21 new (4 in `database.test.ts`'s transient-media-expiry
    and cursor-pagination coverage plus a new v32->v33 migration test; 12
    in `telnyx-fax-webhook.test.ts` for the corrected event/direction
    routing (5), failure-category/page-count propagation (5), and
    transient-media-expiry envelope parsing (2); 1 new HTTP-boundary
    integration test in `server.test.ts` proving the multi-page restart
    sweep against a 150-row backlog). Also corrected four pre-existing
    migration-test fixtures (v26 device-registry, v28, v29, v30 downgrade
    paths) to drop `telnyx_fax_webhook_events` before rolling back their
    `PRAGMA user_version`, fixing a latent "duplicate column name" bug the
    new non-idempotent `ALTER TABLE ADD COLUMN` surfaced in those
    fixtures. 265 total in the focused
    fax/database/channels/telnyx/telnyx-fax-webhook/fax-submission/server/migration
    run. Full suite: 413 node:test cases, 412 passed, 1 skipped (opt-in
    live Twilio, unrelated), 0 failed; `npm run backend:build`,
    `npm run renderer:build`, and vitest (228 cases) all pass;
    `python .local/validate_system.py` passes.
  - **No live fax was sent. No operator Telnyx credential was used. No
    live Telnyx resource was mutated. No inbound provider document was
    downloaded. FAX-007 was not attempted. FAX-009 document acquisition
    was not implemented. FAX-016 was not attempted.**
  - Evidence: `evidence/runs/20260910-fax-phase3-1-webhook-correctness-hardening.json`
    (together with the retained, timestamp-corrected original,
    `evidence/runs/20260910-fax-phase3-telnyx-fax-webhook-ingress.json`).

- **2026-09-10 — Phase 4: inbound fax reception and durable managed
  document acquisition (FAX-007 satisfied), schema v33 → v34.** Turns the
  authenticated `deferred_inbound` events built in Phase 3/3.1 into
  durable inbound fax records with safely-acquired local documents:
  - **Re-froze the inbound contract** against current Telnyx documentation
    (`local-artifacts/phase4-inbound-fax-acquisition-contract.md`):
    confirmed the exact `fax.receiving.started`/`fax.media.processing.started`/
    `fax.received`/`fax.failed` payload fields and the documented ~10
    minute `fax.received.media_url` validity (matching Phase 3.1's
    existing constant). **Explicitly did not assume** `GET /v2/faxes/{id}`
    returns a refreshed media reference once the webhook's own signed URL
    has expired -- current documentation does not say either way, so `GET`
    is implemented as a best-effort reconciliation source only; if neither
    it nor the webhook URL yields a usable reference, acquisition reaches
    a truthful `retryable`/`unavailable` state rather than a fabricated
    success.
  - **Transport state vs. document acquisition state, kept strictly
    separate:** a new `faxes.document_acquisition_state` column
    (`not_required`/`pending`/`acquiring`/`available`/`retryable`/
    `quarantined`/`unavailable`/`deleted`) answers "do we have a safe
    local copy of the document", entirely independent of `faxes.state`
    (FaxState, "what happened to the transmission"). A received fax whose
    PDF fails local validation is never reported as a failed transmission;
    a successful document commit never fabricates a `received` transport
    observation the provider did not report. Proven directly by a
    dedicated test.
  - **Fax Application ownership validation:** `processDeferredInboundFaxEvent`
    (`fax-inbound.ts`, new) compares each event's `connection_id` against
    the configured `TELNYX_FAX_CONNECTION_ID` *before* any local fax is
    touched; a mismatch (including an unconfigured/blank connection id)
    is durably classified `"foreign_connection"` with zero local fax
    lookup, never treated as a signature failure. Deliberately does **not**
    additionally restrict by the `to` number -- a Fax Application may
    legitimately own more than one number, and ForgeLink's current
    configuration records only one for outbound-readiness purposes; that
    product-policy decision is recorded in the Phase 4 contract.
  - **Atomic inbound identity:** `ensureInboundFax(provider, providerFaxId,
    from, to)` (new `database.ts` method) creates exactly one inbound fax
    per `(provider, provider_fax_id)`, is idempotent for a duplicate/
    out-of-order webhook, fills a currently-blank from/to from a later
    event without ever overwriting a known value, and fails closed
    (`null`) rather than guessing when the identity is already bound to a
    fax of the *other* direction. `fax.received` arriving before any
    `receiving.started` event still creates exactly one fax and claims
    document acquisition; a subsequent stale `receiving.started` never
    regresses the already-`received` transport state.
  - **Durable, restart-safe acquisition authority:** a new
    `fax_inbound_acquisitions` table, primary-keyed `(provider,
    provider_fax_id)` so at most one active acquisition exists per inbound
    provider fax -- a duplicate `fax.received` webhook can never start a
    second, concurrent download. `claimNextInboundFaxAcquisition` is a
    CAS-guarded claim (pending, or retryable whose `next_retry_at` has
    passed); `recoverStaleInboundFaxAcquisitions` resets a claim stuck
    `acquiring` past a 5-minute staleness threshold (a crashed worker
    never permanently blocks a provider fax) -- both exercised directly by
    restart-recovery tests.
  - **Media source selection, `GET` fallback, and identity validation
    (`fax-inbound-acquisition.ts`, new):** prefers the still-fresh webhook
    `media_url`; falls back to an authenticated `GET /v2/faxes/{id}`
    (`getTelnyxInboundFaxMediaReference`, new in `telnyx-fax.ts`) only when
    expired/absent, and validates the response's `id`/`direction`/
    `connection_id` against the expected fax before trusting any media URL
    it returns -- a mismatch on any of the three is rejected without ever
    attempting a download.
  - **Media URL / SSRF boundary:** every media URL (webhook or GET-derived)
    passes `validateMediaUrl` -- HTTPS-only, no embedded credentials,
    bounded length, and a forbidden-host check (localhost, loopback,
    `10/8`/`172.16/12`/`192.168/16`, link-local, IPv6 loopback/unique-local/
    link-local). Redirects are followed manually, re-validated at every
    hop, bounded to 3 hops. The Telnyx API bearer token is attached only to
    the `GET` call, **never** to any hop of the media download -- proven
    directly by inspecting the headers an injected test transport actually
    receives. A residual DNS-rebinding limitation (a point-in-time literal-
    host check, no pre-connect IP pinning) is recorded honestly in the
    contract rather than silently assumed away.
  - **Bounded streaming and PDF validation:** `FAX_INBOUND_MAX_BYTES` (20MB,
    a ForgeLink-defined safety limit -- current Telnyx docs do not publish
    an inbound-specific size limit) is checked against `Content-Length`
    when present and enforced during streaming (never `response.arrayBuffer()`
    on unbounded input); only a body starting with the PDF magic bytes is
    ever committed. Oversized/zero-byte/non-PDF content is quarantined or
    discarded -- never committed, never associated with `fax_documents`,
    never treated as a transport failure of the underlying fax.
  - **Private managed document storage:** `ManagedDocumentStore` (new
    `managed-document-store.ts`) -- a provider-neutral primitive under
    `<dataDir>/managed-documents/` (staging/documents/quarantine
    subdirectories), structurally separate from `<dataDir>/uploads/` and
    therefore never reachable through the existing public `/media/:filename`
    route (proven both structurally and by a live end-to-end HTTP test).
    Atomic commit: stage to a zero-byte placeholder, stream bytes, then
    `fs.rename` into `documents/` with hash/size recomputed from the file
    on disk, never a caller claim. No new generic `managed_documents` table
    was introduced -- `fax_documents` already carried everything a managed
    association needs; the filesystem primitive itself is intentionally
    reusable so FAX-009 can stage/commit through it in a later phase
    without a source adapter being built now.
  - **Restart recovery:** `recoverInboundFaxAcquisitions` runs unconditionally
    at backend startup -- resets stale `acquiring` claims and unconditionally
    sweeps any file still under `staging/` (provably abandoned, since a
    committed file is always renamed *out* of staging/ first).
  - **Backup/restore/deletion:** `createBackup`/`restoreLatest` now
    include/restore `<dataDir>/managed-documents/` alongside `uploads/`
    (excluding in-flight `staging/`), with the same rollback-safe rename-
    aside pattern already used for uploads; proven by a test that backs up
    a committed document, deletes its bytes, restores, and verifies the
    hash matches, plus an explicit integrity-check proof that a genuinely
    missing document is reported missing, never silently assumed present.
    `database.deleteFaxDocument(id)` (new) marks the association deleted
    and returns its `local_ref` exactly once, so a second deletion attempt
    is a safe no-op.
  - **Transient URL cleanup:** once a managed document is durably committed,
    the originating ingress row's transient webhook URL/expiry is cleared
    immediately (`clearTelnyxFaxWebhookEventTransientMedia`, new), rather
    than waiting for the Phase 3.1 bulk expiry sweep.
  - **`partial_content`:** parsed and stored as a bounded informational
    field only; current Telnyx documentation does not adequately define
    its semantics, so it is never translated into a completeness/
    corruption judgment in this phase.
  - **Schema:** v33 -> v34 (additive: `telnyx_fax_webhook_events.connection_id`/
    `from_number`/`to_number`/`partial_content`; `faxes.document_acquisition_state`;
    new `fax_inbound_acquisitions` table). Recorded in
    `decisions/0011-schema-migration-coordination.md`.
  - **Tests:** 75 new (`managed-document-store.test.ts`, 8; `fax-inbound.test.ts`,
    8; `fax-inbound-acquisition.test.ts`, 15, covering SSRF/credential-
    separation/streaming-limits/PDF-validation/quarantine/GET-fallback/
    retry-exhaustion/redirect-bounding/restart-recovery; 6 new
    `database.test.ts` tests for the new primitives plus a v33->v34
    migration test; 2 new `server.test.ts` integration tests -- a full
    HTTP webhook-sequence-to-acquired-document end-to-end flow, and
    backup/restore/integrity-check coverage). 305 total in the focused
    fax/database/channels/telnyx/webhook/submission/server/migration/
    inbound run. Full suite: 453 node:test cases, 452 passed, 1 skipped
    (opt-in live Twilio, unrelated), 0 failed; `npm run backend:build`,
    `npm run renderer:build`, and vitest (228 cases) all pass;
    `python .local/validate_system.py` passes.
  - **Materially advances FAX-015** (a substantial negative-test matrix
    across identity/ownership/SSRF/streaming/validation/quarantine/retry/
    restart) but FAX-015 is **not** marked satisfied -- the full
    cross-phase negative matrix (including outbound-side cases from
    earlier phases) has not been independently re-verified as complete in
    this review. FAX-008 (Fax UI), FAX-009 (camera/device/cloud
    acquisition -- the binding document-acquisition scope amendment
    remains untouched), FAX-010 (firewall/draft flow), FAX-011 (MCP), and
    FAX-013 (full retention/privacy policy -- this phase provides
    necessary deletion/backup infrastructure, not the complete criterion)
    all remain pending. FAX-016 remains pending.
  - **No live fax was sent. No operator Telnyx credential was used. No
    live Telnyx resource was mutated. No real inbound fax document was
    downloaded. No camera/Google Drive/OneDrive/Dropbox source was
    implemented. FAX-009 remains pending. FAX-016 was not attempted.**
  - Evidence: `evidence/runs/20260910-fax-phase4-inbound-acquisition.json`.