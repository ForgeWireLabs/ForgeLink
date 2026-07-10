# ForgeLink Private Data Sync Policy Gate

Last verified: 2026-07-10

## Work Item

WI019 - Private Data Sync Policy Gate

## Status

Proposed.

This is a report-only policy slice. It defines the explicit operator policy gate required before any private communication data sync may be implemented.

This document does not implement private-data sync, transport, encryption, key exchange, storage migration, wipe execution, rollback execution, background sync, clustering, failover, quorum, or rqlite.

## Architecture Position

ForgeLink private communication data must remain disabled by default.

A node being installed, paired, linked, trusted, or metadata-sync capable does not permit private-data sync by itself.

Private-data sync requires an explicit operator policy gate that names the data classes, sync mode, encryption requirements, retention behavior, revocation behavior, wipe behavior, conflict handling, rollback handling, audit behavior, and recovery posture.

## Explicit Non-Goals

This policy gate does not define or use:

- rqlite
- Raft
- quorum
- consensus
- failover
- high availability
- database clustering
- whole-database copy
- raw private-data implementation
- automatic private-data sync
- implicit trust elevation
- credential movement
- provider-secret movement
- token movement
- private-key movement
- broad background sync

## Default State

Default private-data sync state:

- disabled
- private_data_policy_pending
- no raw messages
- no contacts
- no calls
- no signal content
- no attachments
- no agent private content
- no private audit/governance payloads

The default policy may permit metadata-only and redacted status rows only when separately allowed by existing link and sync policy.

## Data Sensitivity Classes

ForgeLink policy must distinguish these classes:

- metadata
- redacted
- private
- secret

Metadata may include bounded identifiers, hashes, state names, timestamps, policy ids, checkpoint ids, capability claims, and redacted status rows.

Redacted data may include summaries or labels designed to be safe for cross-device display.

Private data includes user communication content and sensitive operational context.

Secret data includes credentials, tokens, private keys, provider secrets, and authentication material.

Secret data must not be synced through the private-data policy gate.

## Covered Private Data Domains

The policy gate must explicitly cover:

- messages
- contacts
- calls
- signals
- attachments
- agent content
- audit/governance data

No covered domain may become syncable by default.

## Message Policy Gate

Before message sync is allowed, policy must define:

- allowed direction
- allowed peers
- allowed message fields
- redaction profile
- encryption requirement
- retention period
- conflict strategy
- revocation behavior
- wipe behavior
- rollback behavior
- audit event shape
- operator confirmation requirement

Message bodies remain disabled until all required policy fields and implementation controls exist.

## Contact Policy Gate

Before contact sync is allowed, policy must define:

- allowed contact fields
- phone/email/handle redaction rules
- trust-level handling
- blocked/muted status handling
- merge conflict behavior
- retention period
- wipe behavior
- rollback behavior
- audit event shape
- operator confirmation requirement

Contact sync must not silently merge or overwrite local contacts.

## Call Policy Gate

Before call data sync is allowed, policy must define:

- allowed call metadata fields
- forbidden call content fields
- retention period
- redaction profile
- conflict strategy
- wipe behavior
- rollback behavior
- audit event shape
- operator confirmation requirement

Call history remains disabled until a later explicit policy and implementation slice permits it.

## Signal Policy Gate

Before signal data sync is allowed, policy must define:

- allowed signal subscription metadata
- allowed signal item metadata
- summary redaction rules
- source URL handling
- retention period
- conflict strategy
- wipe behavior
- rollback behavior
- audit event shape
- operator confirmation requirement

Raw signal content and private signal-derived content remain disabled until later explicit policy permits them.

## Attachment Policy Gate

Attachment sync requires the strictest gate.

Before attachment sync is allowed, policy must define:

- allowed media classes
- maximum size
- malware scanning requirement
- encryption requirement
- retention period
- wipe behavior
- rollback behavior
- audit event shape
- operator confirmation requirement
- local storage quota

Attachment sync remains disabled by default.

## Agent Content Policy Gate

Before agent content sync is allowed, policy must define:

- allowed agent channels
- allowed urgency classes
- allowed action metadata
- forbidden action payloads
- evidence redaction profile
- decision authority boundary
- retention period
- wipe behavior
- rollback behavior
- audit event shape
- operator confirmation requirement

Agent content sync must not grant approval authority to a linked node.

## Audit and Governance Data Policy Gate

Before audit or governance data sync is allowed, policy must define:

- allowed audit event fields
- allowed hash-chain metadata
- forbidden private payload fields
- governance redaction profile
- retention period
- wipe behavior
- rollback behavior
- tamper-evidence requirements
- operator confirmation requirement

Audit sync must preserve tamper evidence without exposing raw private communication data.

## Required Policy Record Shape

A future policy record should include:

- policy_id
- schema_version
- created_at
- updated_at
- operator_id
- source_node_id
- target_node_id
- link_id
- data_domain
- sensitivity_class
- allowed_sync_modes
- allowed_fields
- forbidden_fields
- redaction_profile
- encryption_required
- retention_days
- conflict_strategy
- revocation_behavior
- wipe_behavior
- rollback_behavior
- audit_required
- operator_confirmation_required
- expires_at

Policy records must be explicit per data domain.

## Required Sync Modes

Initial policy-visible sync modes:

- none
- metadata_only
- redacted
- private_data_disabled
- private_data_policy_pending
- private_data_allowed_after_gate

Private data must remain disabled until the policy mode is explicitly changed by operator-confirmed policy.

## Encryption Requirement

Private-data sync requires encryption before implementation.

Minimum requirements:

- authenticated encryption
- link-scoped key material
- no private keys in envelopes
- no tokens in change sets
- no provider secrets in change sets
- replay protection
- stale-link rejection
- revoked-link rejection
- wipe support
- rollback support
- redacted audit events

WI019 does not implement encryption.

## Retention Requirement

Policy must define retention for every private data domain.

Retention must define:

- maximum local retention
- behavior after revocation
- behavior after wipe request
- behavior after wipe acknowledgement
- behavior after rollback
- audit retention

No indefinite retention is allowed unless explicitly operator-approved.

## Revocation Requirement

Policy must define what happens when a link is revoked.

Required behavior:

- private-data sync stops
- pending private change sets are rejected or quarantined
- linked node status becomes operator-visible
- wipe obligations are evaluated
- audit event is emitted
- relink requires operator approval

Revocation must not depend on clustering, quorum, failover, or peer availability.

## Wipe Requirement

Policy must define wipe request and wipe acknowledgement behavior before private data sync can exist.

Required wipe policy:

- data domains affected
- local metadata retained for audit
- private data removal scope
- acknowledgement requirement
- failure behavior
- unsupported behavior
- audit event shape

Wipe must not erase unrelated local data.

## Conflict Handling Requirement

Policy must define conflict handling before private data sync can exist.

Allowed initial conflict posture:

- reject silent overwrite
- preserve local state
- quarantine conflicting change set
- surface operator-visible degraded state
- emit audit event
- require later explicit resolver for merge behavior

Private data conflicts must not auto-merge by default.

## Rollback Requirement

Policy must define rollback before private data sync can exist.

Rollback policy must define:

- checkpoint requirement
- audit requirement
- local backup or journal requirement
- rollback authorization
- linked-state behavior after rollback
- wipe interaction
- revocation interaction

Rollback must not silently re-enable private-data sync.

## Operator Confirmation Requirement

Private-data sync must require explicit operator confirmation.

Operator confirmation must show:

- source node
- target node
- data domain
- sensitivity class
- sync mode
- redaction profile
- encryption status
- retention period
- revocation behavior
- wipe behavior
- rollback behavior
- conflict behavior
- audit behavior

Pairing, linking, installing, or accepting metadata sync does not count as this confirmation.

## Runtime Gate Decision

A future runtime gate should only allow private data when all checks pass:

- link state is linked
- trust state permits the domain
- policy exists
- policy is not expired
- operator confirmation is recorded
- encryption is available
- retention is defined
- revocation behavior is defined
- wipe behavior is defined
- conflict behavior is defined
- rollback behavior is defined
- audit behavior is defined
- node is not stale
- node is not revoked
- node is not lost
- node is not degraded for private data

Any failed check must deny private-data sync.

## Audit Events

Every policy-gate decision should emit a redacted audit event.

Audit event fields:

- event_id
- event_type
- policy_id
- source_node_id
- target_node_id
- link_id
- data_domain
- sensitivity_class
- requested_sync_mode
- decision
- reason
- created_at
- audit_parent_hash

Audit events must not include raw messages, contacts, call history, attachments, raw signal content, notification body content, credentials, tokens, provider secrets, or private keys.

## Implementation Prep

Later implementation should add:

- private data policy type
- policy validator
- operator confirmation record
- deny-by-default runtime gate
- encryption readiness check
- retention readiness check
- revocation readiness check
- wipe readiness check
- conflict readiness check
- rollback readiness check
- audit event writer
- tests for allowed metadata, redacted data, denied private data, stale denial, revoked denial, missing encryption denial, and missing operator confirmation denial

## Acceptance Criteria Mapping

| Criterion | Status |
| --- | --- |
| Private data sync remains disabled by default | Covered by default state and runtime gate decision |
| Policy distinguishes metadata, redacted data, and private data | Covered by data sensitivity classes |
| Encryption required before implementation | Covered by encryption requirement |
| Retention required before implementation | Covered by retention requirement |
| Revocation required before implementation | Covered by revocation requirement |
| Wipe required before implementation | Covered by wipe requirement |
| Conflict handling required before implementation | Covered by conflict handling requirement |
| Rollback required before implementation | Covered by rollback requirement |
| Validation passes | To be verified by python .local/validate_system.py |
