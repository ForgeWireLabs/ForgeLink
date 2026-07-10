# ForgeLink Proposed Implementation Work Items

Last verified: 2026-07-10

## Purpose

This document proposes the next implementation work items after the cross-device parity direction phase closed at WI020.

The goal of this package is to move ForgeLink from direction-locking into concrete runtime, UI, fixture, and validation work.

These proposed work items intentionally bias toward building visible and testable behavior.

## Operating Boundary

ForgeLink remains a cross-device communications cockpit.

Android, Windows, Linux, and macOS are first-class communication nodes.

The next phase must continue to preserve the corrected architecture boundary:

- no rqlite
- no Raft
- no quorum
- no consensus
- no failover
- no database clustering
- no whole-database copy
- no silent private-data sync
- no raw messages by default
- no contacts by default
- no calls by default
- no signal content by default
- no attachments by default
- no credentials
- no provider secrets
- no tokens
- no private keys

Allowed near-term direction:

- redacted lifecycle status
- metadata-only persistence
- linked-node metadata commands
- deny-by-default policy gates
- signed envelope fixtures
- checkpoint metadata fixtures
- replay/stale/revocation denial fixtures
- operator-visible Settings UI state

## Phase Goal

At the end of this implementation phase, ForgeLink should have a visible, tested cross-device metadata foundation:

- linked nodes have redacted lifecycle status
- Settings shows linked-node lifecycle states clearly
- Android can persist app-local metadata without desktop DB copying
- desktop can expose linked-node metadata through a real shell command stub or endpoint
- private-data gates deny by default through a reusable helper
- signed envelope fixtures validate canonical payloads
- metadata change-set fixtures bind checkpoints and audit hashes
- stale, revoked, degraded, lost, wipe-pending, and wiped states are test-covered

Private communication data should still not move at the end of this phase.

## Proposed Work Item 021 - Redacted Linked-Node Lifecycle Status Model

### Type

Implementation.

### Purpose

Create a shared model for redacted linked-node lifecycle state.

This model should represent revoked, stale, degraded, lost, wipe pending, wiped, linked, and local-only states without exposing private communication data.

### Scope

Add a renderer/shared TypeScript model, likely near the existing node/link status types.

The model should include:

- schema version
- node id
- platform
- device label
- link id optional
- link state
- trust state
- lifecycle state
- sync mode
- redacted health label
- redacted health detail
- private data locked flag
- linked operations paused flag
- recovery action hint
- last seen timestamp optional
- stale after timestamp optional
- revoked at timestamp optional
- wipe request id optional
- wipe acknowledgement id optional
- audit event id optional

### Allowed Lifecycle States

- local_only
- linked
- degraded
- stale
- lost
- revoked
- wipe_pending
- wiped

### Forbidden

- raw messages
- contacts
- calls
- signal content
- attachments
- credentials
- provider secrets
- tokens
- private keys
- automatic relink
- private change-set acceptance

### Acceptance Criteria

- Model can represent all required lifecycle states.
- Every non-healthy state carries a redacted operator-visible detail.
- Private data is locked for degraded, stale, lost, revoked, wipe_pending, and wiped.
- Tests cover state construction for linked, degraded, stale, lost, revoked, wipe_pending, and wiped.
- Validation passes.

### Recommended Commit Message

Model redacted linked node lifecycle states

## Proposed Work Item 022 - Settings Lifecycle Status Rows

### Type

Implementation.

### Purpose

Surface linked-node lifecycle state in Settings so the operator can see revoked, stale, degraded, lost, wipe-pending, and wiped states.

### Scope

Add Settings UI rows that render redacted lifecycle status from the WI021 model.

Rows should show:

- node label
- platform
- lifecycle state
- link state
- sync mode
- private-data lockout state
- linked-operation pause state
- recovery hint
- last seen when available
- stale-after when available
- revoked-at when available
- wipe request or acknowledgement when available

### Required UI Labels

Minimum labels should include:

- Linked node lifecycle
- Private data locked
- Linked operations paused
- Recovery
- Last seen
- Stale after
- Revoked at
- Wipe status

### Forbidden

- raw private data
- raw messages
- contacts
- calls
- signal content
- attachments
- credentials
- provider secrets
- token values
- private keys

### Acceptance Criteria

- Settings renders local-only lifecycle state.
- Settings renders linked lifecycle state.
- Settings renders degraded lifecycle state.
- Settings renders stale lifecycle state.
- Settings renders lost lifecycle state.
- Settings renders revoked lifecycle state.
- Settings renders wipe_pending lifecycle state.
- Settings renders wiped lifecycle state.
- Private-data locked row is visible for unsafe lifecycle states.
- Tests prove stale/revoked/wipe states are operator-visible.
- Validation passes.

### Recommended Commit Message

Show linked node lifecycle status rows

## Proposed Work Item 023 - Android App-Local Metadata Persistence Fixture

### Type

Implementation.

### Purpose

Move the Android local comms store from a pure snapshot helper toward a persistence-ready metadata fixture.

This should still be metadata-only and should not write raw private communication data.

### Scope

Add app-local metadata persistence helpers or fixtures for Android-local comms metadata.

Allowed records:

- schema version
- node id
- platform
- link metadata
- capability cache
- sync checkpoint metadata
- redacted status rows
- lifecycle status rows
- wipe status metadata

### Storage Boundary

Storage may be represented as:

- app-local file-state fixture
- local SQLite-ready shape
- in-memory fixture with serialization tests

Do not add full production persistence until the test fixture shape is stable.

### Forbidden

- desktop database copy
- raw messages
- contacts
- calls
- signal content
- attachments
- provider credentials
- tokens
- private keys

### Acceptance Criteria

- Android metadata snapshot can serialize.
- Android metadata snapshot can deserialize.
- Forbidden data classes are rejected.
- Desktop DB copy remains disabled.
- Private data remains disabled.
- Tests cover persistence fixture round trip.
- Validation passes.

### Recommended Commit Message

Add Android local metadata persistence fixture

## Proposed Work Item 024 - Desktop Linked-Node Metadata Command Stub

### Type

Implementation.

### Purpose

Move the desktop linked-node status from renderer-only helper toward an actual desktop shell command or endpoint stub.

Android and the renderer should be able to query redacted linked-node metadata without private data.

### Scope

Add a desktop-side command stub for linked-node status.

The command should return:

- schema version
- authority node id
- linked nodes
- capability claims
- redacted sync health
- accepted metadata classes
- forbidden private data classes
- private change-set acceptance false
- private-data sync false
- broad background sync false
- clustering false

### Implementation Options

Depending on current structure, this may be:

- Tauri command stub
- shell bridge command implementation
- backend route stub
- fixture-backed desktop command used by tests

### Forbidden

- raw private data sync
- credentials
- provider secrets
- broad background sync
- clustering
- whole database copy

### Acceptance Criteria

- Shell command or endpoint returns redacted metadata only.
- Android can query link status without private data.
- Private change sets are explicitly rejected.
- Tests cover command response shape.
- Validation passes.

### Recommended Commit Message

Implement desktop linked node metadata command

## Proposed Work Item 025 - Deny-By-Default Private Data Policy Gate Helper

### Type

Implementation.

### Purpose

Create a reusable policy-gate helper that denies private-data sync unless every required policy condition is satisfied.

This is a runtime guard, not private-data sync implementation.

### Scope

Add a helper that evaluates private-data sync requests.

Inputs should include:

- source node id
- target node id
- link id
- data domain
- sensitivity class
- requested sync mode
- link state
- trust state
- policy presence
- policy expiry
- operator confirmation presence
- encryption readiness
- retention readiness
- revocation behavior readiness
- wipe behavior readiness
- conflict handling readiness
- rollback readiness
- audit readiness

Output should include:

- decision allow or deny
- reason code
- redacted reason
- audit event type

### Required Default

The default decision is deny.

### Required Denial Reasons

- missing_policy
- policy_expired
- missing_operator_confirmation
- encryption_unavailable
- retention_undefined
- revocation_undefined
- wipe_undefined
- conflict_handling_undefined
- rollback_undefined
- audit_undefined
- link_stale
- link_revoked
- link_lost
- link_degraded
- unsupported_data_domain
- unsupported_sync_mode

### Forbidden

- allowing private sync by default
- allowing private sync because pairing exists
- allowing private sync because link exists
- allowing private sync because metadata sync exists
- moving raw private data

### Acceptance Criteria

- Missing policy denies.
- Missing operator confirmation denies.
- Missing encryption denies.
- Missing wipe behavior denies.
- Missing rollback behavior denies.
- Stale link denies.
- Revoked link denies.
- Lost link denies.
- Degraded link denies for private data.
- Metadata-only requests remain separate from private-data approval.
- Tests cover all denial paths.
- Validation passes.

### Recommended Commit Message

Add private data policy gate helper

## Proposed Work Item 026 - Signed Envelope Fixture Validator

### Type

Implementation.

### Purpose

Create a fixture-level validator for signed link envelopes.

This should validate envelope structure, canonical payload rules, required fields, allowed operations, nonce presence, timestamp presence, and hash linkage.

### Scope

Add a validator for envelope fixtures.

Allowed operations:

- link_request
- link_accept
- link_revoke
- sync_policy_update
- change_set_offer
- change_set_ack
- wipe_request
- wipe_ack
- stale_notice

Required fields:

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
- payload_hash
- signature metadata

### Fixture Boundary

This work item should not implement production crypto.

It may validate fixture signature shape and canonical payload shape.

### Forbidden

- private keys
- real secret material
- tokens
- credentials
- raw messages
- contacts
- calls
- attachments
- production key exchange

### Acceptance Criteria

- Valid fixture envelope passes.
- Unknown operation fails.
- Missing nonce fails.
- Missing timestamp fails.
- Missing policy id fails.
- Forbidden data class fails.
- Missing payload hash fails.
- Missing signature metadata fails.
- Tests pass.
- Validation passes.

### Recommended Commit Message

Validate signed link envelope fixtures

## Proposed Work Item 027 - Metadata Change-Set Fixture Validator

### Type

Implementation.

### Purpose

Create a fixture validator for metadata-only communication change sets.

This should bind change-set metadata to node id, link id, policy id, checkpoint hash, envelope hash, data classes, sync mode, and audit parent hash.

### Scope

Add a metadata change-set fixture type and validator.

Required fields:

- change_set_id
- source_node_id
- target_node_id
- link_id
- policy_id
- base_checkpoint_hash
- result_checkpoint_hash
- envelope_hash
- data_classes
- sync_mode
- operation_count
- payload_hash
- audit_parent_hash
- created_at

Allowed data classes:

- node_link_status
- pairing_status
- capability_cache
- sync_checkpoint_metadata
- redacted_sync_health
- redacted_status_rows
- wipe_status
- audit_event_hashes

### Forbidden

- raw messages
- contacts
- calls
- signal content
- attachments
- credentials
- provider secrets
- tokens
- private keys

### Acceptance Criteria

- Valid metadata change set passes.
- Private data class fails.
- Missing checkpoint hash fails.
- Missing envelope hash fails.
- Missing audit parent hash fails.
- Unsupported sync mode fails.
- Operation count is bounded.
- Tests pass.
- Validation passes.

### Recommended Commit Message

Validate metadata change-set fixtures

## Proposed Work Item 028 - Checkpoint and Replay Guard Fixtures

### Type

Implementation.

### Purpose

Add fixture-level checkpoint and replay guard behavior for metadata sync.

### Scope

Create helpers or validators for:

- checkpoint id
- previous checkpoint hash
- current checkpoint hash
- link id
- policy id
- nonce tuple
- replay rejection
- stale checkpoint rejection
- revoked link rejection

Replay tuple:

- source node id
- target node id
- link id
- operation
- nonce

### Forbidden

- production network replay store
- private-data movement
- raw private payloads
- credentials
- tokens

### Acceptance Criteria

- Duplicate nonce tuple rejects.
- Stale checkpoint rejects.
- Revoked link rejects.
- Missing previous checkpoint rejects when required.
- Redacted audit reason is produced for rejection.
- Tests pass.
- Validation passes.

### Recommended Commit Message

Add checkpoint replay guard fixtures

## Proposed Work Item 029 - Redacted Audit Event Writer Fixture

### Type

Implementation.

### Purpose

Add a redacted audit event fixture writer for linked-node lifecycle and metadata sync decisions.

### Scope

Audit event fixture should support:

- lifecycle transition
- policy gate denial
- stale detection
- revocation
- wipe request
- wipe acknowledgement
- replay rejection
- checkpoint rejection
- metadata change-set acceptance
- metadata change-set quarantine

Required event fields:

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

### Forbidden

- raw messages
- contacts
- call history
- attachments
- raw signal content
- notification body content
- credentials
- provider secrets
- tokens
- private keys

### Acceptance Criteria

- Accepted event fixture is redacted.
- Rejected event fixture is redacted.
- Policy denial event includes reason code.
- Replay rejection event includes nonce hash, not raw secret material.
- Event chain can reference audit parent hash.
- Tests pass.
- Validation passes.

### Recommended Commit Message

Add redacted linked node audit fixtures

## Proposed Work Item 030 - Android Linked-Node Metadata Query Path

### Type

Implementation.

### Purpose

Allow Android-side code to query linked-node metadata and lifecycle state without private data.

### Scope

Build a metadata query path that can consume the desktop linked-node status shape and local Android metadata store shape.

Query should return:

- local Android node id
- authority node id
- link state
- lifecycle state
- capability claims
- sync mode
- redacted sync health
- private data locked flag
- recovery hint

### Forbidden

- raw messages
- contacts
- calls
- signal content
- attachments
- credentials
- provider secrets
- tokens
- private keys
- private change-set acceptance

### Acceptance Criteria

- Android metadata query returns redacted linked-node status.
- Query works for local-only.
- Query works for linked.
- Query works for degraded.
- Query works for stale.
- Query works for revoked.
- Private data locked flag is true for unsafe states.
- Tests pass.
- Validation passes.

### Recommended Commit Message

Add Android linked node metadata query

## Proposed Work Item 031 - Cross-Platform Shell Contract Parity

### Type

Implementation-prep plus tests.

### Purpose

Define and test shell bridge contract parity for Windows, Linux, macOS, and Android node metadata.

### Scope

Add contract fixtures proving each platform can express:

- node id
- platform
- device label
- link state
- trust state
- sync mode
- capability claims
- redacted health
- private data disabled by default

### Forbidden

- platform-specific private-data shortcut
- credentials
- provider secrets
- token values
- private keys
- clustering

### Acceptance Criteria

- Windows fixture passes.
- Linux fixture passes.
- macOS fixture passes.
- Android fixture passes.
- Unknown platform fixture degrades safely.
- Tests pass.
- Validation passes.

### Recommended Commit Message

Test cross-platform node metadata contracts

## Proposed Work Item 032 - Lifecycle Implementation Closeout

### Type

Report-only closeout after WI021-WI031 are implemented.

### Purpose

Close the first build-forward implementation phase and decide whether ForgeLink is ready to begin private-data gate implementation or needs more metadata-only hardening.

### Scope

Ledger should cover:

- lifecycle model
- Settings UI rows
- Android metadata persistence fixture
- desktop linked-node metadata command
- private-data policy gate helper
- signed envelope fixture validator
- metadata change-set fixture validator
- checkpoint/replay fixtures
- redacted audit fixtures
- platform shell contract parity

### Acceptance Criteria

- Implementation status is clear.
- Remaining gaps are explicit.
- Private data is still disabled by default.
- Validation passes.

### Recommended Commit Message

Close linked node lifecycle implementation phase

## Recommended Execution Order

1. WI021 - Redacted Linked-Node Lifecycle Status Model
2. WI022 - Settings Lifecycle Status Rows
3. WI023 - Android App-Local Metadata Persistence Fixture
4. WI024 - Desktop Linked-Node Metadata Command Stub
5. WI025 - Deny-By-Default Private Data Policy Gate Helper
6. WI026 - Signed Envelope Fixture Validator
7. WI027 - Metadata Change-Set Fixture Validator
8. WI028 - Checkpoint and Replay Guard Fixtures
9. WI029 - Redacted Audit Event Writer Fixture
10. WI030 - Android Linked-Node Metadata Query Path
11. WI031 - Cross-Platform Shell Contract Parity
12. WI032 - Lifecycle Implementation Closeout

## Build Bias

Only WI032 should be report-only by default.

WI021 through WI031 should produce code, tests, fixtures, or visible UI.

Reports are allowed only when needed to close implementation evidence, not to delay building.

## Validation Standard

Every implementation work item should pass:

- focused renderer or unit tests for the changed surface
- python .local/validate_system.py
- pre-push checks
- clean working tree after generated Electron renderer bundle is restored

## Commit Discipline

Use one commit per work item.

Keep each work item small enough that failure can be diagnosed from one focused test run.

Do not mix private-data policy implementation with UI rows or metadata fixtures.

Do not mix envelope validation with Android persistence.

Do not allow private-data movement in any proposed work item in this package.
