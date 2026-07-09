# ForgeLink Communication Change-Set Sync Architecture

Last verified: 2026-07-10

## Work Item

WI015 - Communication Change-Set Sync Architecture

## Status

Proposed.

This is a report-only architecture slice. It defines DB linking as signed communication change-set exchange, not database clustering.

This document does not implement sync, transport, private-data movement, encryption, storage migrations, key exchange, background jobs, or Android local storage.

## Architecture Position

Every ForgeLink device owns its local SQLite database.

Android, Windows, Linux, and macOS are all ForgeLink communication nodes. A node may link with another node, advertise capabilities, exchange signed metadata, and later exchange policy-gated communication change sets.

A link relationship does not merge databases. It creates a signed, policy-gated communication-sync relationship between independently owned local stores.

## Explicit Non-Goals

This architecture explicitly does not define or use:

- rqlite
- Raft
- consensus
- quorum
- high availability
- failover
- database clustering
- whole-database copy
- remote execution
- runner scheduling
- private-data sync implementation
- automatic trust elevation
- raw message movement
- contact movement
- call-history movement
- attachment movement
- provider credential movement
- token movement

## Local SQLite Ownership

Each node remains the authority for its own local SQLite database.

Node-local ownership means:

- schema migration is local to the node
- backups are local to the node
- rollback is local to the node
- retention policy is enforced locally
- private-data unlock state is local
- provider credentials stay local
- a linked peer cannot directly write another node's database
- remote changes are imported only through policy-gated change-set application

Future Android storage must start with local metadata only. Raw messages, contacts, calls, signal content, attachments, and secrets remain forbidden until later explicit policy and implementation slices permit them.

## Communication Change-Set Model

A communication change set is a signed, bounded set of proposed state changes or metadata observations.

A change set is not a database dump.

A change set should include:

- change_set_id
- source_node_id
- target_node_id
- link_id
- policy_id
- checkpoint_base_hash
- checkpoint_result_hash
- envelope_hash
- data_classes
- sync_mode
- created_at
- expires_at
- operation_count
- payload_hash
- redaction_profile
- audit_parent_hash

The payload format is out of scope for WI015. This report only defines the architecture boundary.

## Change-Set Boundaries

Change sets must be bounded by data class, policy, checkpoint, and link state.

Initial allowed data classes for architecture planning:

- attention_policy
- agent_channel_metadata
- pairing_status
- node_link_status
- sync_policy
- audit_event
- redacted_summary
- change_set_metadata
- wipe_status

Forbidden until later explicit policy and implementation:

- raw messages
- contacts
- call history
- attachments
- raw signal content
- notification body content
- private keys
- tokens
- credentials
- provider secrets

## Checkpoints

A checkpoint is a hash-addressed summary of sync-visible state for a specific node, link, policy, and data-class set.

Checkpoints should be used to:

- detect whether a peer is up to date
- bind change-set offers to prior state
- detect stale peers
- support rollback decisions
- support audit reconstruction
- avoid whole-DB copying

Checkpoint records should include:

- checkpoint_id
- node_id
- link_id
- policy_id
- data_classes
- sync_mode
- state_hash
- previous_checkpoint_hash
- created_at
- audit_parent_hash

Checkpoint hashes must not reveal raw private content.

## Per-Data-Class Sync Policy

Each data class requires an explicit policy entry.

Policy entries should define:

- data_class
- allowed_sync_modes
- source_node_roles
- target_node_roles
- redaction_required
- encryption_required
- retention_days
- conflict_strategy
- wipe_required_on_revoke
- operator_confirmation_required

No data class may become syncable only because a node is linked.

## Sync Modes

Initial sync modes:

- none
- metadata_only
- redacted
- private_data_disabled
- private_data_policy_pending

Private data remains disabled in this architecture report. A later implementation must explicitly define encryption, unlock, retention, wipe, audit, and rollback behavior before any private data can move.

## Conflict Detection

Conflict detection should compare:

- base checkpoint hash
- current local checkpoint hash
- source node id
- target node id
- link id
- policy id
- data class
- operation id
- operation timestamp
- operation hash

A conflict exists when a change set is based on a checkpoint that is not the current accepted checkpoint for that link and data-class policy.

## Conflict Resolution Posture

Default conflict posture is conservative.

Initial posture:

- reject silent overwrite
- preserve local state
- quarantine conflicting change set
- emit audit event
- surface operator-visible degraded state when needed
- require explicit later resolver for merge behavior

Allowed automatic resolution should be limited to metadata-only idempotent updates where policy explicitly permits it.

Private data conflicts must not be auto-merged in this phase.

## Encryption Requirement for Private Data

Any later private-data movement requires encryption before transport and encryption at rest on the receiving node.

Minimum future requirements:

- explicit operator approval
- link-specific policy
- device-bound key material
- no private keys in envelopes
- no provider credentials in change sets
- authenticated encryption
- replay protection
- wipe behavior
- rollback behavior
- redacted audit events

WI015 does not implement this.

## Revocation Behavior

Revocation must stop linked operations for the revoked link id.

On revocation, a node should:

- mark link state revoked
- stop accepting change-set offers
- stop sending change-set offers
- preserve local data according to local retention policy
- queue or record wipe obligations when policy requires them
- emit audit event
- require operator-approved relink before resuming linked operations

Revocation does not imply unrelated local data deletion.

## Wipe Behavior

Wipe behavior is policy-gated and data-class scoped.

A wipe request should specify:

- link_id
- source_node_id
- target_node_id
- policy_id
- data_classes
- checkpoint_hash
- reason
- requested_at
- audit_parent_hash

Wipe acknowledgement should reference the wipe request and record what was removed or not present.

Wipe must never erase unrelated local data.

## Stale and Degraded Behavior

A link becomes stale or degraded when checkpoints, timestamps, policy ids, or capability claims no longer validate.

Stale or degraded behavior should:

- pause linked operations
- keep local-only operation available
- surface operator-visible state
- reject private-data movement
- allow bounded metadata repair if policy permits
- emit audit event

## Audit Events

Every accepted, rejected, quarantined, revoked, wiped, stale, degraded, or rolled-back change-set action should emit a redacted audit event.

Audit events should include:

- event_id
- event_type
- source_node_id
- target_node_id
- link_id
- policy_id
- data_classes
- sync_mode
- checkpoint_hash
- change_set_hash
- envelope_hash
- decision
- reason
- created_at
- audit_parent_hash

Audit events must not include raw messages, contacts, call history, attachments, raw signal content, tokens, credentials, provider secrets, or private keys.

## Rollback Behavior

Rollback is local-first.

A node should be able to roll back an accepted change set by using:

- prior checkpoint hash
- change-set audit record
- local backup or journal
- data-class policy
- rollback authorization decision

Rollback should not require a peer to be online.

Rollback should emit an audit event and should not silently re-enable linked operations after revocation or stale detection.

## Node Platform Scope

Android, Windows, Linux, and macOS are all in scope as ForgeLink communication nodes.

Platform differences affect storage APIs, secure storage, notification APIs, and background execution policy. They do not change the architecture boundary: each node owns its local database and participates through signed, policy-gated communication change sets.

## Implementation Sequence

Recommended later sequence:

1. Android local SQLite comms store stub for metadata only
2. Shared change-set metadata type
3. Checkpoint metadata type
4. Policy validator for data classes and sync modes
5. Audit event writer
6. Replay and stale-link checks
7. Redacted fixture tests
8. Later private-data design only after encryption, wipe, rollback, and operator approval are specified

## Acceptance Criteria Mapping

| Criterion | Status |
| --- | --- |
| Architecture separates local DB ownership from sync | Covered by local SQLite ownership and communication change-set model |
| Private data requires explicit later implementation | Covered by non-goals, data-class boundaries, and encryption section |
| Android, Windows, Linux, and macOS are all in scope | Covered by node platform scope |
| No cluster language appears | The report rejects database clustering and does not propose any clustered topology |
| Validation passes | To be verified by python .local\validate_system.py |
