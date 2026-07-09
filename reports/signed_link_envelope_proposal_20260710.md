# ForgeLink Signed Link Envelope Proposal

Last verified: 2026-07-10

## Work Item

WI014 - Signed Link Envelope Proposal

## Status

Proposed.

This is a report-only / implementation-prep slice. It defines the signed envelope shape ForgeLink can implement later for cross-device link and communication-sync operations.

This document does not implement transport, storage synchronization, key exchange, private-data movement, background sync, or device pairing.

## Architecture Position

ForgeLink devices are communication nodes. A desktop, Android phone, Linux workstation, or macOS workstation can participate in a link relationship only after policy and trust state permit it.

A ForgeLink link is not a database cluster. It is a signed, policy-gated communication relationship between nodes.

## Explicit Non-Goals

This proposal explicitly does not define or implement:

- rqlite
- Raft
- quorum
- failover
- high-availability topology
- database clustering
- private-data sync execution
- raw message replication
- contact replication
- attachment replication
- key exchange
- background transport
- automatic trust elevation
- notification approval authority

## Envelope Operations

The first envelope version should support these operations:

- link_request
- link_accept
- link_revoke
- sync_policy_update
- change_set_offer
- change_set_ack
- wipe_request
- wipe_ack
- stale_notice

## Canonical Envelope Shape

Every signed envelope should use canonical JSON before signing.

Required top-level fields:

- schema_version
- op
- source_node_id
- target_node_id
- link_id
- timestamp
- nonce
- required_capabilities
- data_classes
- sync_mode
- policy_id
- base_checkpoint_hash
- change_set_hash
- audit_parent_hash
- payload_hash
- signature

The signature value signs the canonical envelope body with the signature object removed.

Initial signature algorithm:

- ed25519

## Allowed Operations

Allowed operation names:

- link_request
- link_accept
- link_revoke
- sync_policy_update
- change_set_offer
- change_set_ack
- wipe_request
- wipe_ack
- stale_notice

Unknown operations must be rejected.

## Allowed Sync Modes

Initial sync modes:

- none
- metadata_only
- redacted
- private_data_disabled
- private_data_policy_pending

## Initial Data Classes

Allowed initial data classes:

- attention_policy
- agent_channel_metadata
- pairing_status
- node_link_status
- sync_policy
- audit_event
- redacted_summary
- change_set_metadata
- wipe_status

The initial envelope proposal does not permit raw messages, contacts, call history, attachments, provider credentials, tokens, private keys, or raw signal content as data classes.

## Replay Protection

Every receiver must reject repeated envelopes with the same tuple:

- source_node_id
- target_node_id
- link_id
- op
- nonce

Receivers should also reject envelopes outside the accepted timestamp window.

Rejected replay attempts should produce a bounded audit event without exposing secrets or raw communication content.

## Audit Linkage

Every accepted envelope should produce an audit record.

Every rejected envelope should produce a bounded, redacted audit record when safe.

Audit records should include:

- schema_version
- op
- source_node_id
- target_node_id
- link_id
- policy_id
- timestamp
- nonce_hash
- payload_hash
- base_checkpoint_hash
- change_set_hash
- audit_parent_hash
- decision
- reason

Audit records must not include private keys, tokens, credentials, provider secrets, raw messages, contacts, call history, attachments, or raw signal content.

## Operation Semantics

### link_request

Requests creation of a link relationship. The receiver verifies signature, timestamp, nonce, source node, and policy before surfacing the request to the operator. A link request does not grant private-data sync and does not count as operator consent.

### link_accept

Accepts a link request after operator-visible policy allows it. The receiver verifies request lineage, policy id, signature, timestamp, and nonce. Private messages and contacts remain disabled unless a later explicit policy slice permits them.

### link_revoke

Revokes an existing link. A valid revoke stops linked capabilities, records an audit event, and requires future relink before linked operations resume.

### sync_policy_update

Announces or acknowledges a new communication-sync policy snapshot. Receivers must verify policy id, trust state, and audit linkage. Policy updates must not silently expand data classes.

### change_set_offer

Offers a communication change set by hash. The receiver verifies base checkpoint hash, change-set hash, policy id, link state, timestamp, and nonce. WI014 does not apply raw private data.

### change_set_ack

Acknowledges a change-set offer by hash. The acknowledgement is bound to the current checkpoint and audit chain.

### wipe_request

Requests linked data removal for a revoked or policy-reduced relationship. The receiver verifies signature and policy, records the request, and does not erase unrelated local data.

### wipe_ack

Acknowledges a wipe request. The receiver verifies the acknowledgement references a known wipe request and records an audit event. The link remains revoked unless a later operator-approved relink occurs.

### stale_notice

Marks a link as stale or degraded. Linked capabilities must pause or degrade until revalidation succeeds.

## Secret and Private-Data Boundary

The envelope may include metadata hashes and bounded identifiers.

The envelope must not include:

- private keys
- tokens
- credentials
- provider secrets
- raw messages
- contacts
- call history
- attachments
- raw signal content
- notification body content
- raw private-data payloads

## Later Implementation Notes

A later implementation slice should add:

- a shared envelope type
- canonical JSON serializer
- signing and verification helper
- nonce/replay store
- audit-record writer
- operation validator
- fixture tests for accepted and rejected envelopes

A later communication change-set slice should define the payload format. That slice must still keep communication sync separate from database clustering.

## Acceptance Criteria Mapping

| Criterion | Status |
| --- | --- |
| Proposal is explicit enough to implement later | Covered by canonical shape, required fields, operation semantics, replay protection, and audit linkage |
| Secrets are never included in signed metadata | Covered by secret and private-data boundary |
| Replay protection is required | Covered by replay tuple and timestamp requirements |
| Audit linkage is required | Covered by audit linkage section |
| Tests are not required unless executable fixture is added | No executable fixture added |
| No private-data sync implementation | Report-only |
| No key exchange implementation | Report-only |
| No rqlite, quorum, failover, or clustering | Explicit non-goals |
