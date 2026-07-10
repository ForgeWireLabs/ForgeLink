# ForgeLink Cross-Device Parity Closeout Ledger

Last verified: 2026-07-10

## Work Item

WI020 - Cross-Device Parity Closeout Ledger

## Status

Closed direction phase.

This report closes the corrected cross-device node/link/comms-sync direction phase and lists the remaining work required to reach full ForgeLink parity.

This ledger does not implement runtime sync, private-data sync, key exchange, transport, wipe execution, rollback execution, clustering, failover, quorum, rqlite, or whole-database copy.

## Direction Locked

ForgeLink is a cross-device communications cockpit.

Android, Windows, Linux, and macOS are first-class ForgeLink communication nodes.

A node may operate local-only, request a link, become linked under policy, degrade, become stale, be revoked, or participate in future wipe acknowledgement semantics.

ForgeLink cross-device behavior is signed, policy-gated communication sync. It is not database clustering.

## Explicitly Rejected Direction

The corrected direction rejects:

- rqlite
- Raft
- quorum
- consensus
- failover
- high availability topology
- database clustering
- whole-database copy
- silent private-data sync
- raw private-data movement by default
- provider credential movement
- token movement
- private-key movement
- broad background sync without explicit policy

## Platform Parity Scope

ForgeLink parity covers:

- Windows
- Linux
- macOS
- Android

Parity does not mean every platform has identical APIs. It means every platform is represented as a node with explicit capability claims, link state, trust state, sync mode, policy gates, redacted health, and local ownership boundaries.

## Windows Ledger

Windows is currently the strongest desktop authority target.

Current direction:

- local desktop authority node
- local database ownership
- linked-node metadata visibility
- capability claims
- redacted sync health
- no private change-set acceptance yet

Remaining Windows work:

- concrete desktop linked-node command implementation beyond stub
- local metadata persistence for linked nodes
- signed envelope validation fixtures
- checkpoint metadata fixture
- revocation/stale/wipe UI rows
- deny-by-default private-data policy gate runtime helper

## Linux Ledger

Linux should follow the same node model as Windows.

Current direction:

- first-class node platform
- local database ownership
- metadata-only linked-node model
- no platform-specific private-data shortcut

Remaining Linux work:

- platform-specific shell command wiring
- local metadata persistence path
- secure storage review
- desktop linked-node status parity tests
- packaging validation

## macOS Ledger

macOS should follow the same node model as Windows and Linux.

Current direction:

- first-class node platform
- local database ownership
- metadata-only linked-node model
- no platform-specific private-data shortcut

Remaining macOS work:

- platform-specific shell command wiring
- secure storage and keychain review
- local metadata persistence path
- desktop linked-node status parity tests
- packaging validation

## Android Ledger

Android is first-class, not a weaker bolt-on client.

Current completed direction:

- Android pairing status surface
- Android local node/link status
- Android participation in cross-platform capability matrix
- Android local comms store stub
- metadata-only local store boundary
- private-data disabled by default
- desktop DB copy disabled

Remaining Android work:

- Android app-local metadata persistence
- linked-node metadata query path
- redacted status rows for revoked, stale, degraded, lost, wipe pending, and wiped
- signed envelope fixture validation
- checkpoint metadata persistence
- policy-gate UI surface before any private data
- later transport only after policy gates are implemented

## Local-Only Mode

Local-only mode remains a valid operating mode.

Local-only behavior:

- node owns local state
- no linked peer required
- no private-data sync
- no desktop database copy
- no remote authority
- capability claims can still be displayed
- local settings and metadata can persist locally

Remaining local-only work:

- persist local metadata store
- expose local node identity consistently
- show local-only capability matrix without implying missing functionality

## Linked Mode

Linked mode means a signed, policy-gated relationship exists between nodes.

Linked mode allows only what policy permits.

Allowed current posture:

- link metadata
- capability claims
- redacted sync health
- checkpoint metadata
- redacted status rows

Still forbidden by default:

- raw messages
- contacts
- calls
- signal content
- attachments
- agent private content
- private audit/governance payloads
- credentials
- provider secrets
- tokens
- private keys

Remaining linked-mode work:

- implement shell command endpoint beyond stub
- add signed envelope validation
- add checkpoint metadata records
- add linked-node UI rows
- add audit event fixtures

## Degraded Mode

Degraded mode means the link exists but health, capability, policy, or checkpoint validation is impaired.

Required degraded behavior:

- local operation continues
- linked operations are limited
- private data remains locked out
- redacted health is visible
- audit event is emitted
- recovery hint is shown

Remaining degraded work:

- add runtime degraded status mapper
- add UI status row
- add tests for degraded metadata-only behavior

## Revoked and Stale Mode

Revoked and stale states must be operator-visible.

Revoked behavior:

- link trust terminated
- linked operations stopped
- private change sets rejected
- relink requires operator approval
- audit event emitted

Stale behavior:

- linked operations paused
- local-only operation remains available
- private change sets rejected
- revalidation required
- audit event emitted

Remaining revoked/stale work:

- add redacted status model
- add UI rows
- add metadata retention fixtures
- add wipe request and acknowledgement metadata types
- add tests for revoked and stale denial behavior

## Metadata Sync

Metadata sync is the only cross-device sync direction currently allowed.

Allowed metadata classes:

- node_link_status
- pairing_status
- capability_cache
- sync_checkpoint_metadata
- redacted_sync_health
- redacted_status_rows
- wipe_status
- audit event ids and hashes

Metadata sync must remain signed, bounded, and policy-gated.

Remaining metadata sync work:

- shared metadata change-set type
- signed envelope fixture validator
- checkpoint fixture validator
- redacted audit event writer
- replay protection fixture
- stale-link rejection fixture

## Private-Data Policy Gate

Private-data sync remains disabled by default.

Private data cannot move until policy explicitly defines:

- data domain
- sensitivity class
- allowed fields
- forbidden fields
- redaction profile
- encryption requirement
- retention behavior
- revocation behavior
- wipe behavior
- conflict handling
- rollback handling
- audit behavior
- operator confirmation

Covered private domains:

- messages
- contacts
- calls
- signals
- attachments
- agent content
- audit/governance data

Remaining policy-gate work:

- private data policy type
- deny-by-default validator
- operator confirmation record
- missing-encryption denial
- stale-link denial
- revoked-link denial
- missing-wipe denial
- missing-rollback denial
- tests for all denial paths

## Signed Change-Set Future Work

Future signed change-set work should build on the envelope proposal and metadata sync architecture.

Remaining signed change-set work:

- canonical JSON serializer
- envelope type
- signing fixture
- verification fixture
- nonce replay store fixture
- checkpoint hash binding
- change-set hash binding
- audit parent hash binding
- rejected replay audit event
- rejected stale checkpoint audit event

No signed change-set work should introduce private-data sync until the policy gate is implemented and tested.

## Build-Next Recommendation

After this closeout, the next phase should move from direction locking into concrete implementation.

Recommended next implementation order:

1. Redacted revocation/stale/wipe status model
2. Settings UI rows for revoked, stale, degraded, lost, wipe pending, and wiped states
3. Android app-local metadata persistence fixture
4. Desktop linked-node metadata command implementation beyond renderer stub
5. Deny-by-default private-data policy gate helper
6. Signed envelope fixture validator
7. Metadata change-set fixture validator

This keeps the project building while preserving the corrected architecture boundary.

## Completed Slice Ledger

| Slice | Status | Result |
| --- | --- | --- |
| WI010 Android pairing status surface | Complete | Android pairing states visible |
| WI011 cross-device comms sync direction | Complete | Corrected no-cluster direction recorded |
| WI012 node link status | Complete | Shared node/link status model and bridge hook |
| WI013 cross-platform capability matrix | Complete | Android/desktop node capabilities shown by link state |
| WI014 signed link envelope proposal | Complete | Envelope semantics recorded |
| WI015 communication change-set sync architecture | Complete | DB linking defined as change-set sync, not clustering |
| WI016 Android local comms store stub | Complete | Metadata-only local Android store stub |
| WI017 desktop linked-node status stub | Complete | Redacted metadata-only desktop stub |
| WI018 revocation/stale/wipe semantics | Complete | Behavior defined before private sync |
| WI019 private-data sync policy gate | Complete | Private sync remains disabled by default |
| WI020 cross-device parity closeout ledger | This report | Direction phase closeout |

## Acceptance Criteria Mapping

| Criterion | Status |
| --- | --- |
| Future work is clear | Covered by platform ledgers and build-next recommendation |
| Android is first-class | Covered by Android ledger and platform parity scope |
| No rqlite/clustering/failover framing appears | Rejected explicitly as non-direction |
| Validation passes | To be verified by python .local/validate_system.py |
