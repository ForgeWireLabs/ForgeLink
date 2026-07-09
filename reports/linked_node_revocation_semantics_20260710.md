# ForgeLink Linked Node Revocation, Stale, and Wipe Semantics

Last verified: 2026-07-10

## Work Item

WI018 - Revocation, Stale, and Wipe Semantics

## Status

Proposed.

This is a report-only / implementation-prep slice. It defines what happens when a linked ForgeLink node is revoked, stale, lost, degraded, or wiped.

This document does not implement private-data sync, wipe execution, transport, background sync, key exchange, database copy, clustering, failover, quorum, or rqlite.

## Architecture Position

ForgeLink nodes communicate through signed, policy-gated links. A linked node relationship is not a database cluster and does not create shared database authority.

Revocation, stale state, lost state, degraded state, and wipe behavior must be defined before any private communication data sync is implemented.

## Explicit Non-Goals

This semantics document does not define or use:

- rqlite
- Raft
- quorum
- consensus
- failover
- high availability
- database clustering
- whole-database copy
- private-data sync implementation
- raw message movement
- contact movement
- call-history movement
- attachment movement
- signal-content movement
- credentials
- provider secrets
- tokens
- private keys

## Link States

Initial link-state semantics:

- local_only: node has no active linked peer
- link_requested: link request exists but does not grant trust
- linked: link exists and metadata-only or redacted sync may occur if policy permits
- degraded: link exists but capability, checkpoint, or health validation is impaired
- stale: peer has not revalidated within policy window
- lost: peer is unreachable and cannot currently participate
- revoked: link trust has been terminated
- wipe_pending: wipe has been requested but not acknowledged
- wiped: wipe acknowledgement has been recorded

Existing runtime types may not include every future state yet. Until implementation catches up, lost, wipe_pending, and wiped may be represented through redacted status rows, audit events, or implementation-prep records rather than active UI enum values.

## UI State Requirements

Every non-healthy link state must be operator-visible.

UI should show:

- node label
- platform
- link state
- trust state
- sync mode
- redacted health summary
- last seen timestamp when available
- stale-after timestamp when available
- revoked timestamp when available
- pending wipe state when available
- recovery action hint

UI must not hide stale, degraded, lost, revoked, or wipe-pending states behind a generic offline label.

UI must not expose raw messages, contacts, calls, signal content, attachments, secrets, credentials, provider tokens, or private keys.

## Local Metadata Retention

Local metadata may be retained after revocation or stale detection for safety, audit, and recovery.

Retainable metadata:

- node id
- device label
- platform
- link id
- link state
- trust state
- sync mode
- capability claims
- policy id
- checkpoint hashes
- change-set hashes
- envelope hashes
- redacted status rows
- wipe request id
- wipe acknowledgement id
- audit event ids
- timestamps

Forbidden retained private data until later explicit policy:

- raw messages
- contacts
- call history
- attachments
- raw signal content
- notification body content
- provider credentials
- tokens
- private keys

## Private-Data Lockout

Private-data lockout is mandatory for revoked, stale, lost, degraded, and wipe-pending links.

Lockout means:

- no private change-set offers
- no private change-set acceptance
- no raw message movement
- no contact movement
- no call-history movement
- no attachment movement
- no raw signal-content movement
- no provider credential movement
- no token movement
- no background repair that expands data classes

Metadata-only repair may be allowed only when policy permits it and the operation is audit-linked.

## Pending Sync Behavior

When a link becomes revoked, stale, lost, degraded, or wipe-pending, pending sync must be paused.

Pending metadata-only sync may be:

- retained as queued metadata
- quarantined
- marked stale
- discarded according to retention policy
- retried only after recovery policy permits it

Pending private sync is not allowed in the current architecture and must remain disabled.

## Queued Changes

Queued changes must be data-class scoped.

For allowed metadata classes, queued changes should record:

- queue id
- source node id
- target node id
- link id
- policy id
- data classes
- checkpoint hash
- change-set hash
- envelope hash
- queued at
- state
- reason

Allowed queue states:

- queued
- paused
- stale
- quarantined
- discarded
- applied
- revoked
- wipe_pending

Queued changes must not include raw private content.

## Revocation Behavior

Revocation terminates trust for a link id.

On revocation, a node must:

- mark link state revoked
- stop linked operations
- reject private change sets
- reject new metadata change sets unless recovery policy permits them
- retain redacted metadata needed for audit
- surface revoked state to the operator
- emit an audit event
- require operator-approved relink before linked operations resume

Revocation does not depend on clustering, quorum, failover, shared database authority, or remote availability.

Revocation does not erase unrelated local data.

## Stale Behavior

A link becomes stale when the peer has not revalidated within the policy window, checkpoint lineage no longer matches, or capability claims cannot be verified.

On stale detection, a node must:

- mark state stale
- show stale state to the operator
- pause linked operations
- reject private change sets
- allow local-only operation to continue
- emit an audit event
- require revalidation before linked operations resume

Stale state must be visible and must not be silently treated as healthy.

## Lost Behavior

A link is lost when the peer cannot be reached and no current health signal is available.

Lost state differs from stale state:

- lost means peer unreachable
- stale means peer trust or checkpoint freshness is no longer valid

A lost node should degrade to local-only behavior for local features while linked operations remain paused.

## Degraded Behavior

A link is degraded when some metadata path remains available but health, capability, checkpoint, or policy validation is incomplete.

Degraded behavior:

- local features continue
- linked features are limited
- private-data movement remains disabled
- redacted health is displayed
- audit event is emitted
- recovery path is shown

## Wipe Request

A wipe request is a signed, policy-gated request to remove data associated with a link and data-class scope.

A wipe request should include:

- wipe_request_id
- source_node_id
- target_node_id
- link_id
- policy_id
- data_classes
- reason
- requested_at
- checkpoint_hash
- envelope_hash
- audit_parent_hash

Wipe request handling must:

- verify signature when available
- verify policy
- verify data-class scope
- mark wipe_pending
- stop linked operations for affected data classes
- emit audit event
- avoid erasing unrelated local data

## Wipe Acknowledgement

A wipe acknowledgement records the result of a wipe request.

A wipe acknowledgement should include:

- wipe_ack_id
- wipe_request_id
- source_node_id
- target_node_id
- link_id
- policy_id
- data_classes
- result
- completed_at
- checkpoint_hash
- envelope_hash
- audit_parent_hash

Allowed acknowledgement results:

- wiped
- already_absent
- policy_denied
- unsupported
- quarantined
- failed

A wipe acknowledgement must not include raw private content.

## Audit Events

Every revocation, stale detection, lost detection, degraded transition, wipe request, wipe acknowledgement, queued-change quarantine, queued-change discard, and recovery transition should emit a redacted audit event.

Audit event fields:

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
- wipe_request_id
- wipe_ack_id
- decision
- reason
- created_at
- audit_parent_hash

Audit events must not include raw messages, contacts, call history, attachments, raw signal content, notification body content, provider credentials, tokens, secrets, or private keys.

## Recovery Path

Recovery must be explicit and operator-visible.

Recovery options:

- remain local-only
- retry metadata-only health check
- revalidate stale peer
- accept limited metadata-only relink
- revoke link
- request wipe
- acknowledge wipe
- create new link after operator approval

Recovery must not silently restore private-data sync.

Recovery must not bypass revocation.

Recovery must not trust a stale checkpoint without validation.

## Operator-Visible Recovery Hints

Suggested UI hints:

- Revoked: This node link was revoked. Relink requires operator approval.
- Stale: This node has not revalidated within policy. Linked operations are paused.
- Lost: This node is unreachable. Local-only operation remains available.
- Degraded: This node has limited metadata health. Private data remains locked out.
- Wipe pending: A wipe request is pending acknowledgement.
- Wiped: A wipe acknowledgement was recorded for the scoped data classes.

## Implementation Prep

Later implementation should add:

- redacted revocation status model
- stale/lost/degraded status mapper
- wipe request metadata model
- wipe acknowledgement metadata model
- queued metadata change state
- audit event helper
- UI status rows
- fixture tests for revoked, stale, lost, degraded, wipe_pending, and wiped states

Private-data sync must remain disabled until WI019 or later policy gates explicitly permit it.

## Acceptance Criteria Mapping

| Criterion | Status |
| --- | --- |
| Revocation does not depend on clustering | Covered by architecture position and revocation behavior |
| Stale state is operator-visible | Covered by UI state requirements and stale behavior |
| Wipe semantics are defined before private-data sync | Covered by wipe request and wipe acknowledgement sections |
| Validation passes | To be verified by python .local/validate_system.py |
