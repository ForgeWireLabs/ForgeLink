# Work Item 040 — Regulated Communications Data and Provider Boundary

**Status:** Proposed

## Intent

Make ForgeLink safe to compose with workloads that may carry regulated or
otherwise sensitive information without turning every message, call, approval,
notification, provider adapter, backup, or audit record into an uncontrolled
copy of that data.

ForgeLink is a local-first human decision and communications boundary. That
makes it a potential downstream processor of classifications created elsewhere:
PHI/health context, PII, credentials, financial/KYC material, confidential
business data, and other restricted content can arrive through agent requests,
SMS/MMS, voice/call history, contacts, evidence packs, callbacks, and approval
records.

This work item establishes the ForgeLink side of the regulated-workload
contract. It does **not** claim that ForgeLink is HIPAA compliant, SOC 2
certified, PCI compliant, or otherwise legally certified.

## Scope

### Classification-aware communication

Define a versioned communication classification contract that can map to the
canonical ForgeWire regulated-data vocabulary while remaining independently
usable. Classification and handling restrictions must survive:

- local agent-channel and MCP requests;
- human approval requests and evidence packs;
- contacts and contact timelines;
- SMS/MMS bodies and attachments;
- voice/call metadata and any future transcripts/recordings;
- desktop/mobile notifications;
- provider webhooks and callbacks;
- drafts and reviewed outbox items;
- backup, restore, export, retention, and deletion; and
- tamper-evident audit/replay records.

### Healthcare/PHI boundary

If PHI-capable ForgeWire/MEDIC workflows use ForgeLink, provider and channel
eligibility must be explicit. Local-only, Twilio, Telnyx, future providers, SMS,
MMS, voice, notifications, webhook infrastructure, support/debugging, and
backups must not be assumed interchangeable.

Where an operator's healthcare deployment requires a BAA or another provider
contract, ForgeLink policy must be able to represent and enforce provider
eligibility rather than relying on documentation memory. Disallowed PHI routes
must fail closed or require an explicit governed downgrade/redaction step.

### Communications consent and purpose

The existing external-contact consent ledger and communication firewall remain
core primitives. This item extends them so consent/purpose, channel, recipient,
classification, retention, and external-send authority are reviewed together.
Automated SMS/voice consent and legal obligations remain separately
jurisdiction-reviewed; product controls must not imply universal legal consent.

### Data lifecycle

Backups and exports are currently sensitive plaintext artifacts even when the
live application protects credentials. Regulated profiles require explicit
handling for export encryption, destination, retention, restore, operator
warnings, and deletion. The design must reconcile privacy erasure requests with
audit records that may need retained non-payload evidence.

### Observability and evidence

Logs, notification bodies, webhook diagnostics, provider errors, screenshots,
support bundles, audit chains, and RepoPact evidence must minimize or redact
regulated payloads. Tests should prove that useful operational evidence remains
possible without copying message bodies, patient facts, account identifiers, or
secrets into durable engineering artifacts.

## Dependencies and coordination

This item coordinates with ForgeWire WI214/WI263 but does not require ForgeLink
to import the ForgeWire codebase. The cross-repo contract should be versioned and
provider-neutral.

Existing ForgeLink work on secure credentials, redacted notifications, consent,
communication firewall, local authenticated agent channels, retention, audit,
and linked-node metadata is prior art to reuse rather than duplicate.

## Non-goals

- claiming HIPAA, PCI DSS, SOC 2, GDPR/CCPA, TCPA, or other legal compliance;
- turning ForgeLink into a medical record system;
- storing full regulated payloads in RepoPact evidence;
- assuming SMS or voice is an appropriate channel merely because it is
  technically available; or
- weakening the local-first and draft-before-send boundaries.
