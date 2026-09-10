# Work Item 041 — First-Class Fax Communications and Telnyx Fax Edge

**Status:** Proposed  
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

- [ ] **FAX-001** Seal and document the ForgeLink-native product boundary: humans can use fax directly; external agents/applications may use governed API/MCP; ForgeWire/Fabric are not required or authoritative.
- [ ] **FAX-002** Define a provider-neutral `fax_edge` capability family and specialized fax contracts without widening SMS/MMS message contracts into an ambiguous universal payload.
- [ ] **FAX-003** Add durable fax transmission, document-reference, and event-ledger persistence with migrations, restart recovery, normalized lifecycle transitions, and explicit ambiguous-side-effect semantics.
- [ ] **FAX-004** Add a separate Telnyx Programmable Fax configuration/validation surface and adapter while preserving separation from Telnyx messaging, voice, and ForgeWire inference configuration.
- [ ] **FAX-005** Implement outbound Telnyx fax submission, provider ID/status normalization, bounded safe errors, cancellation/reconciliation where supported, and duplicate-safe retry policy.
- [ ] **FAX-006** Add a dedicated signed Telnyx fax webhook route reusing hardened signature/freshness primitives while keeping fax event parsing/lifecycle separate from SMS/MMS; prove enqueue-before-ack, deduplication, ordering, restart drain, and unsupported-event handling.
- [ ] **FAX-007** Implement inbound fax reception and managed local document acquisition with authenticated download, strict media/resource validation, opaque local references, quarantine/failure behavior, retention, deletion, backup/export, and recovery semantics.
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