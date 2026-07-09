# ForgeLink Cross-Device Comms Sync Direction - 2026-07-09

## Purpose

This report corrects the Android runtime completion direction before Work Item 011 continues.

ForgeLink must target parity across:

- Windows;
- Linux;
- macOS;
- Android.

Android is not a companion-only terminal.

Android is a first-class ForgeLink communication node.

Desktop link is not clustering. Desktop link is a trust and communication-sync relationship between ForgeLink nodes.

## Supersedes

This direction supersedes any remaining work-item wording that frames Android as only:

- mobile-local;
- companion-only;
- decision-terminal-only;
- permanently deferred from full cockpit parity.

The restricted decision terminal remains a valid profile, but it is not the Android product boundary.

## Hard Boundary: No Clustering

ForgeLink is a cross-device communications cockpit.

ForgeLink is not:

- a clustered control plane;
- a high-availability infrastructure system;
- a quorum system;
- a failover system;
- a replicated hub cluster;
- a rqlite-backed state cluster.

## rqlite Decision

rqlite is explicitly out of scope for ForgeLink comms sync.

This is not an optional backend.

This is not a future maybe.

Do not introduce:

- rqlite;
- Raft;
- voters;
- quorum;
- cluster topology;
- HA state;
- cluster backup/restore;
- failover terminology.

The Fabric repository may inform trust primitives, but ForgeLink must not inherit Fabric's clustering/storage model.

## Fabric-Informed, Not Fabric-Embedded

ForgeWire Fabric remains useful as a source of patterns.

Allowed Fabric-informed primitives:

- signed envelopes;
- node/device identity shape;
- nonce and replay protection;
- capability advertisement;
- policy gates;
- hash-chain audit;
- operator-visible trust transitions;
- discovery/link setup concepts.

Do not borrow:

- rqlite;
- clustering;
- quorum;
- failover;
- hub HA;
- runner scheduling semantics;
- remote execution assumptions;
- Fabric task queues as message sync;
- Loom command execution as cockpit parity.

## Correct Model

ForgeLink nodes exchange communication state.

A ForgeLink node may be:

- Windows desktop;
- Linux desktop;
- macOS desktop;
- Android device.

A ForgeLink node may operate in one of these states:

- local-only;
- linked;
- replicated by explicit communication-sync policy;
- degraded;
- revoked;
- stale.

This is not DB clustering.

This is policy-gated communication sync.

## DB Link Direction

The phrase "DB link" means signed, policy-gated change-set exchange.

It does not mean copying the desktop private database to Android.

It does not mean clustering SQLite.

It does not mean consensus replication.

It does mean:

- local SQLite ownership per node;
- explicit node identity;
- signed link/change envelopes;
- per-data-class sync policy;
- encrypted private data when allowed;
- retention rules;
- revocation rules;
- wipe semantics;
- conflict detection;
- operator-visible degraded states;
- auditability.

## Data Classes

Future sync policy must distinguish:

### Local-only secret material

Never sync:

- provider credentials;
- tokens;
- private keys;
- MCP token values;
- agent-channel token values;
- secure-store material.

### Link and trust metadata

May sync after explicit link establishment:

- node id;
- device label;
- platform;
- link state;
- trust state;
- capability claims;
- last seen;
- revoked/stale state;
- schema version.

### Operational cockpit metadata

May sync under metadata policy:

- unread counts;
- redacted status;
- redacted channel state;
- capability matrix;
- queue metadata;
- sync health.

### Private communication data

May sync only after explicit later implementation defines encryption, retention, revocation, wipe, conflict handling, and rollback:

- messages;
- contacts;
- call rows;
- signal items;
- attachments;
- raw agent content.

### Governance/audit data

May sync only with redaction and hash-chain protections:

- approvals;
- decisions;
- evidence refs;
- audit hashes;
- revocation/wipe acknowledgements.

## Required Language

Use:

- node;
- link;
- comms sync;
- signed change set;
- capability advertisement;
- sync policy;
- trust state;
- revocation;
- wipe;
- stale/degraded.

Do not use:

- cluster;
- quorum;
- voter;
- failover;
- HA;
- rqlite;
- Raft;
- replicated control plane.

## Revised Work Item Direction

WI011 and later must move from Android-only pairing metadata toward cross-device node/link foundations.

The next implementation must not persist Android-only private-data assumptions that would block Windows/Linux/macOS/Android parity.

## Acceptance Criteria For This Direction Correction

- A direction report exists.
- The active work package is updated so WI011 onward reflects cross-device comms sync.
- rqlite and clustering are explicitly forbidden.
- Android is recorded as a first-class ForgeLink node.
- Future DB linking is defined as signed change-set communication sync, not database clustering.
