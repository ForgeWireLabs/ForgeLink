---
audience: maintainers and implementation agents
status: active
last_verified: 2026-07-22
source_of_truth: work/active/037-telnyx-production-hardening-and-expansion/README.md; work/active/037-telnyx-production-hardening-and-expansion/work-item.json
---

# Work Item 037: Telnyx Production Hardening and Expansion

## Goal

Turn ForgeLink's first-class Telnyx SMS/MMS foundation into a production-correct,
operator-manageable communications edge, then add the Telnyx capabilities that fit
ForgeLink's local-first human-authority model. Expose only bounded, approval-aware
ForgeLink communications capabilities to ForgeWire Fabric; do not make Fabric a
second telecom authority or credential owner.

## Executive decision

Work items 035 and 036 established secure Telnyx settings, explicit provider
selection, real account-object validation, signed SMS/MMS webhooks, automatic
profile webhook setup, provider-specific onboarding, capability presentation, and
selected-edge context. The July 22 deep dive found that this is a strong first
slice but not yet a complete production integration.

The canonical `forgewire/forgewire-fabric` implementation contains no Telnyx
adapter. That is the correct starting boundary. Fabric dispatches agent work and
discovers MCP tools; ForgeLink owns communications state, contact policy, reviewed
drafts, approvals, provider credentials, sends, inbound messages, and delivery
evidence. Fabric integration therefore occurs through a bounded ForgeLink MCP
surface, not through Telnyx code or raw provider credentials in Fabric.

## Evidence-backed gaps

The current implementation has these concrete gaps:

1. Ed25519 verification does not reject stale `telnyx-timestamp` values, leaving
   signed payloads replayable inside an unbounded window.
2. Webhook `data.id`, `data.occurred_at`, delivery attempt, and destination are not
   durably modeled. Arrival order and message ID are used as approximations.
3. Raw Telnyx statuses flow into a generic rank table that does not recognize
   `delivery_failed`, `delivery_unconfirmed`, `gw_timeout`, or `dlr_timeout`.
4. Inbound MMS stores expiring, API-authenticated Telnyx URLs as if they were durable
   renderer-ready media.
5. Automatic setup overwrites the profile's primary webhook without failover,
   prior-owner detection, preserved rollback state, or a stable-versus-temporary
   tunnel distinction.
6. Validation checks SMS capability but the adapter advertises MMS unconditionally.
7. Provider failures lose actionable redacted codes, retryability, rate-limit state,
   compliance failures, and ambiguous-send semantics.
8. Operators paste phone numbers and profile IDs instead of selecting discovered
   account resources with health, traffic type, registration, and capabilities.
9. Opt-out, 10DLC, toll-free verification, Message Detail Record, encoding, segment,
   cost, spend, and number-health state are not integrated into ForgeLink policy or
   diagnostics.
10. Evidence is deterministic and credential-free; no opt-in live Telnyx end-to-end
    gate exists.
11. Tauri truthfully reports that its local service and secure provider storage are
    not yet available, so Telnyx production parity remains Electron-only.

## Binding architecture

```text
ForgeWire Fabric task
  -> discovers ForgeLink MCP capability
  -> requests status or creates reviewed communication draft
  -> ForgeLink communication firewall and human authority
  -> explicitly selected provider-specific edge
  -> Telnyx API/webhook
  -> normalized local message, decision, delivery, and evidence records
```

The following never cross into Fabric:

- Telnyx API key or webhook public key;
- raw provider response bodies;
- private message or media content in task/audit metadata;
- implicit permission to send;
- unreviewed provider configuration mutation.

Fabric task ID, ForgeLink request/draft/decision ID, local message ID, provider name,
redacted provider message ID, normalized delivery outcome, and timestamps may be
correlated when policy permits. Audit records identify secret names at most, never
secret values.

## Milestone 0: production correctness and security

### Webhook security and ingestion

- Verify the signature over the exact raw request body.
- Parse the Telnyx timestamp as Unix time and reject invalid, future-skewed, or stale
  requests using a documented default tolerance no greater than five minutes.
- Store event ID, message ID, event type, occurred-at, received-at, attempt, target,
  processing status, and a bounded redacted failure category.
- Transactionally enqueue a valid event before returning `2xx`, then process it away
  from the public request path within the local runtime.
- Deduplicate on `data.id`; use `occurred_at` and provider-specific transition rules
  for out-of-order events.
- Allow-list understood messaging events. Unknown authentic events are acknowledged
  and recorded as unsupported without being misclassified as delivery updates.

### Delivery and error semantics

- Map Telnyx lifecycle values to provider-neutral states without losing a safe
  provider-specific detail code.
- Model terminal success, terminal failure, unconfirmed delivery, gateway timeout,
  DLR timeout, carrier rejection, recipient opt-out, sender registration, invalid
  destination, profile disabled, balance, queue expiry, and rate limiting.
- Distinguish a definite pre-send rejection from an ambiguous transport failure
  after the request may have reached Telnyx. Do not make an unsafe automatic retry
  claim when duplication cannot be excluded.
- Reconcile ambiguous or stale outbound rows through a bounded Message Detail Record
  lookup using the provider message ID when available.

### Durable MMS

- Fetch inbound Telnyx media immediately with bearer authentication.
- Enforce redirect, scheme, host, count, per-object, aggregate-size, duration,
  timeout, MIME allow-list, extension, and decompression limits before persistence.
- Store media through ForgeLink's managed local upload path and replace provider URLs
  with local opaque references.
- Preserve retention, backup, restore, export-redaction, deletion, and quarantine
  behavior; never expose the Telnyx API key to the renderer.

### Safe webhook ownership

- Read and display current primary/failover/version configuration before mutation.
- Identify temporary tunnel URLs and warn when they are unsuitable as a durable
  production endpoint.
- Require an explicit operator preview/confirmation when replacing a non-ForgeLink
  URL or changing profile behavior.
- Configure and test failover where the operator provides an independent endpoint.
- Verify the returned profile and a signed test delivery where supported.
- Store sufficient redacted prior state to restore the exact previous configuration.

## Milestone 1: operator operations and compliance

### Discovery and capability truth

- List messaging profiles and messaging phone numbers read-only.
- Let the operator select a discovered resource instead of typing opaque identifiers.
- Show exact SMS/MMS support, country, number type, traffic type, profile assignment,
  health, eligible products, and enabled state.
- Advertise `mms_send` only when the selected sender or profile path supports it.
- Support read-only inspection for multiple profiles/numbers before any number-pool
  or provisioning mutation is authorized.

### Consent and sender registration

- Ingest `autoresponse_type` and synchronize STOP/START into the local consent/contact
  policy with source, scope, and timestamp.
- Block reviewed and direct sends locally when the contact is opted out; record the
  policy decision before calling Telnyx.
- Report 10DLC brand/campaign/number assignment and toll-free verification status,
  including pending/rejected remediation, without claiming legal compliance.
- Keep registration creation, resubmission, and number assignment as separate,
  previewed operator mutations with dedicated evidence if later authorized.

### Operational visibility

- Present redacted Message Detail Record data: normalized status, provider status,
  encoding, parts, cost/currency, timestamps, registration state, error code/category,
  and wait/rate pressure.
- Add profile daily-spend state and alerts without making billing mutations silently.
- Aggregate delivery, failure, opt-out, segment, cost, and number-health trends using
  bounded local records that exclude message bodies and private media.

## Milestone 2: advanced Telnyx messaging

Each feature is opt-in, provider-specific, reversible, and visible in Settings:

- smart encoding with composer segment/cost preview;
- explicit GSM-7/UCS-2 behavior where appropriate;
- MMS transcoding and preflight guidance;
- daily spend limits and alerts;
- number pools with long-code/toll-free weights;
- sticky sender, geomatch, and unhealthy-number skipping;
- hosted SMS for numbers whose voice service remains elsewhere;
- provider scheduling/cancellation only when it remains subordinate to ForgeLink's
  reviewed-outbox approval and cancellation record.

Number purchasing, porting, profile creation, hosted-number orders, number assignment,
registration, and billing are not implicit setup conveniences. Each requires an
operator-confirmed plan, before/after state, and rollback or cancellation contract.

## Milestone 3: separate Telnyx capability families

### Programmable Voice

Implement a Telnyx `voice_edge`, not an SMS flag. It owns its Voice API application,
outbound voice profile, connection ID, number, signed webhook route, call-control ID,
and provider status mapping. Basic inbound/outbound call, answer, reject, hangup,
transfer, DTMF, and reconciliation come before recording, transcription, answering
machine detection, conferencing, media streaming, or Voice AI.

Recording/transcription require explicit consent, jurisdiction policy, visual state,
retention, export, deletion, and evidence. AI/media streaming remains gated until
human authority and real-time privacy boundaries are separately approved.

### RCS

Implement RCS as its own channel capability with RCS Agent configuration, rich-card,
carousel, suggested-action/reply, file, location, read-receipt, and device-capability
contracts. SMS fallback must be explicit, preserve the approved plain-text fallback,
and record which edge actually delivered. RCS webhook payloads are not parsed through
the SMS/MMS payload model.

### Verify, Lookup, and WhatsApp

- Verify is a bounded identity/contact-verification capability with server-side rate
  limits, country allow-lists, attempt limits, fraud controls, and no claim that a
  verified phone number is durable human identity or sufficient authentication.
- Number Lookup is advisory line/carrier/portability metadata, not identity proof.
- WhatsApp is a separate business-messaging adapter with template, conversation
  window, consent, media, webhook, and fallback contracts.

These capabilities may be split into new work items before implementation. Splitting
is mandatory when a slice introduces a new schema family, credential family, public
webhook, compliance regime, or release gate.

## Milestone 4: ForgeLink MCP and Fabric integration

ForgeLink should expose bounded tools/resources such as:

```text
communications.status
communications.draft.create
communications.draft.inspect
communications.send.request_approval
telnyx.health.read
telnyx.compliance.read
telnyx.mdr.read_redacted
```

Rules:

- Read tools return redacted, policy-filtered summaries.
- The default write tool creates a reviewed draft; it does not send.
- Approval/send remains inside ForgeLink's existing authority and firewall path.
- Tool metadata advertises whether human approval is required and which provider
  capabilities are currently available without exposing credentials.
- Fabric routes only to a runner that advertises the ForgeLink MCP capability.
- A Fabric task ID is accepted as correlation metadata and recorded through draft,
  decision, send, delivery, and evidence without importing the task prompt.
- Fabric's secret broker and task egress are not used for ordinary Telnyx sends;
  ForgeLink's OS-protected provider store remains the credential owner.
- Any Fabric UI, hub, runner, store, or MCP-routing change begins with a companion
  governed work item in the canonical in-tree Fabric implementation and proves
  Desktop/VSIX/shared-contract parity under Fabric's own contract.

## Acceptance criteria

- [ ] **TXE-001** Preserve this research, priority, architecture, and security contract.
- [x] **TXE-002** Harden webhook verification, durable ingestion, deduplication, ordering, and acknowledgement.
- [ ] **TXE-003** Complete status/error normalization and MDR reconciliation.
- [ ] **TXE-004** Make inbound Telnyx MMS media durable, authenticated, bounded, private, and recoverable.
- [ ] **TXE-005** Make webhook mutation ownership-safe, failover-aware, verified, and reversible.
- [ ] **TXE-006** Add profile/number discovery and exact capability/health/registration truth.
- [ ] **TXE-007** Add outbound resilience plus an opt-in real-account Telnyx smoke gate.
- [ ] **TXE-008** Integrate consent, opt-out, 10DLC, and toll-free status with local policy.
- [ ] **TXE-009** Add redacted MDR, encoding, segment, cost, spend, rate, and health visibility.
- [ ] **TXE-010** Add explicitly gated advanced messaging-profile features.
- [ ] **TXE-011** Implement Telnyx Voice as a separate voice-edge family.
- [ ] **TXE-012** Gate RCS, Verify, Lookup, and WhatsApp as separate capability families.
- [ ] **TXE-013** Add the approval-aware ForgeLink MCP surface and governed Fabric discovery path.
- [ ] **TXE-014** Preserve local/Twilio/Tauri/accessibility/data-safety posture and full evidence.

## Validation and evidence matrix

Each satisfied criterion needs one or more durable evidence runs. The union must cover:

| Surface | Required proof |
| --- | --- |
| Webhook security | valid signature, invalid signature, stale/future timestamp, replay, duplicate event, out-of-order events, unknown authentic event |
| Delivery | every mapped Telnyx lifecycle state, terminal conflict, MDR recovery, ambiguous send, bounded retry |
| MMS | authenticated download, expiry simulation, redirects, invalid MIME, oversized media, timeout, quarantine, backup/restore/export/retention |
| Profile mutation | preview, explicit confirmation, existing owner, primary/failover, temporary URL warning, postcondition, rollback |
| Discovery/compliance | multiple profiles/numbers, SMS-only, MMS-capable, disabled, unassigned, 10DLC, toll-free, opt-out/start |
| Operations | MDR redaction, cost/segments, spend/rate alert, no message body or secret leakage |
| MCP/Fabric | capability discovery, reviewed draft default, denied implicit send, approval correlation, secret absence, audit reconstruction |
| Shells | Electron real path, renderer accessibility, Tauri honest unavailable state until real parity |
| Live Telnyx | designated test resources only; validate, send, signed inbound, final delivery, MMS, failover, rollback; fully redacted evidence |

## Non-goals and explicit gates

- Fabric does not become a communications database, contact-policy engine, or Telnyx
  secret owner.
- Telnyx is not made the core product or a silent fallback for every channel.
- No automatic 10DLC/toll-free submission, number purchase, port, hosted-number order,
  profile creation, number reassignment, spend-limit change, or billing action.
- No automatic Voice recording, transcription, media streaming, AI calling, or
  outbound campaign behavior.
- No phone verification claim is treated as passkey-equivalent identity proof.
- No production-ready claim based only on fixtures, mocks, or a compiling Tauri stub.

## Research basis

Official Telnyx documentation reviewed on 2026-07-22:

- <https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks>
- <https://developers.telnyx.com/docs/messaging/messages/receive-message>
- <https://developers.telnyx.com/docs/messaging/messages/message-detail-records>
- <https://developers.telnyx.com/docs/messaging/messages/messaging-profiles-overview>
- <https://developers.telnyx.com/docs/messaging/messages/phone-number-configuration>
- <https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out>
- <https://developers.telnyx.com/docs/messaging/10dlc/quickstart>
- <https://developers.telnyx.com/docs/messaging/toll-free-verification>
- <https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals>
- <https://developers.telnyx.com/docs/messaging/messages/send-an-rcs-message>
- <https://developers.telnyx.com/docs/identity/verify/quickstart>
- <https://developers.telnyx.com/docs/identity/number-lookup/quickstart>

## Evidence log

| Criterion | Evidence | Result |
| --- | --- | --- |
| TXE-002 | `evidence/runs/20260722-txe002-replay-safe-telnyx-webhooks.json` | Exact-body Ed25519 verification with five-minute freshness; durable enqueue-before-ack, event-ID replay protection, occurrence ordering, startup recovery, explicit event routing, and bounded/redacted payload retention passed deterministic and full repository gates. |

TXE-001 and TXE-003 through TXE-014 remain pending. Work items 035 and 036 remain
the evidence-backed baseline for the existing integration but do not satisfy those
remaining criteria.

## Rollback

Every implementation slice must remain separately revertible. Reverting WI-037 work
must leave the completed WI-035/WI-036 Telnyx SMS/MMS configuration, explicit provider
selection, provider-specific shared cockpit, local-only behavior, and Twilio paths
operational. Provider mutations restore recorded prior state before code rollback.
