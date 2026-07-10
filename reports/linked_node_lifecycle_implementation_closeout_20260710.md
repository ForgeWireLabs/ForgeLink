# ForgeLink Linked-Node Lifecycle Implementation Closeout

Last verified: 2026-07-10

## Work Item

WI032 — Lifecycle Implementation Closeout

## Status

Complete.

This report closes the first build-forward linked-node implementation phase covering WI021 through WI031.

The phase established a metadata-only, policy-gated foundation for ForgeLink communication-node relationships across desktop and Android surfaces.

It did not implement private communication-data movement, production cryptography, production transport, key exchange, background synchronization, database replication, or clustering.

## Closeout Decision

ForgeLink is **not yet ready to move private communication data between linked nodes**.

The repository now contains the required lifecycle, policy, validation, replay, audit, Android-query, and cross-platform contract foundations needed to safely prepare for later work.

However, private-data execution must remain disabled until production-grade trust, encryption, consent, storage, transport, recovery, revocation, wipe, rollback, and audit behavior are implemented and validated together.

The next phase should therefore remain metadata-only and focus on hardening the linked-node control and evidence boundaries.

## Architecture Position

ForgeLink devices are communication nodes.

A linked-node relationship is:

- signed;
- policy-gated;
- operator-visible;
- capability-scoped;
- lifecycle-aware;
- replay-protected;
- checkpoint-bound;
- audit-linked;
- metadata-first;
- independently stored on each node.

A linked-node relationship is not:

- a database cluster;
- a distributed SQLite database;
- a whole-database copy;
- a Raft or consensus group;
- a high-availability topology;
- a failover system;
- an automatic private-data replication channel;
- an automatic trust grant.

Each node remains authoritative for its own local database and local retention, backup, rollback, unlock, credential, and storage behavior.

## Implemented Work Ledger

### WI021 — Redacted Linked-Node Lifecycle Status Model

Commit: `56db620 Model redacted linked node lifecycle states`

Implemented:

- local-only, linked, degraded, stale, lost, revoked, wipe-pending, and wiped lifecycle states;
- redacted health labels and details;
- operator-visible recovery hints;
- lifecycle timestamps;
- wipe request and acknowledgement references;
- audit-event references;
- private-data lockout decisions;
- linked-operation pause decisions.

Safety posture:

- degraded, stale, lost, revoked, wipe-pending, and wiped states lock private data;
- stale, lost, revoked, wipe-pending, and wiped states pause linked operations;
- lifecycle state never grants private-data access.

### WI022 — Settings Lifecycle Status Rows

Commit: `6f1d05e Show linked node lifecycle status rows`

Implemented operator-visible Settings rows for lifecycle, link, sync, lockout, pause, recovery, last-seen, stale, revocation, and wipe status.

Safety posture:

- unsafe lifecycle states are visible instead of silently degrading;
- no raw private communication data or secrets are rendered.

### WI023 — Android App-Local Metadata Persistence Fixture

Commit: `e60fc44 Add Android local metadata persistence fixture`

Implemented:

- Android-local metadata snapshot;
- app-local persistence envelope;
- serialization and deserialization;
- schema-version checks;
- metadata checkpoint records;
- capability cache;
- redacted status rows;
- local link metadata;
- explicit forbidden-data declarations.

Safety posture:

- Android owns only local ForgeLink metadata at this stage;
- private data remains disabled;
- desktop database copying remains disabled;
- unsupported or private data classes are rejected.

### WI024 — Desktop Linked-Node Metadata Command

Commit: `7077482 Implement desktop linked node metadata command`

Implemented:

- desktop-side linked-node metadata command;
- Tauri command registration;
- redacted desktop authority status;
- linked-node list;
- safe capability claims;
- accepted metadata classes;
- forbidden private-data classes;
- redacted sync health.

Safety posture:

- private change sets are rejected;
- private-data sync is disabled;
- broad background synchronization is disabled;
- clustering is disabled.

### WI025 — Deny-by-Default Private-Data Policy Gate

Commit: `b6f07fb Add private data policy gate helper`

Implemented denial reasons for missing or expired policy, absent operator confirmation, unavailable encryption, undefined retention/revocation/wipe/conflict/rollback/audit behavior, unsafe link states, unsupported domains, and unsupported sync modes.

Safety posture:

- default decision is deny;
- pairing, linking, and metadata synchronization do not grant private-data permission;
- an allowed result represents policy eligibility only and moves no payload.

### WI026 — Signed Link-Envelope Fixture Validator

Commit: `31cb8f2 Validate signed link envelope fixtures`

Implemented fixture validation for schema, operations, identities, timestamp, nonce, capabilities, data classes, sync mode, policy, checkpoint linkage, change-set linkage, audit linkage, payload hash, signature metadata shape, timestamp window, and replay tuple.

Safety posture:

- unknown operations reject;
- replayed tuples reject;
- forbidden private-data classes reject;
- fixture signature shape is checked without production cryptography;
- no private key or secret material is included.

### WI027 — Metadata Change-Set Fixture Validator

Commit: `a2749e9 Validate metadata change set fixtures`

Implemented validation for change-set identity, node/link/policy identity, base/result checkpoints, envelope/payload/audit hashes, redaction profile, timestamps, safe classes and modes, bounded operations, operation identities, timestamps, hashes, class consistency, explicit redaction, and duplicate rejection.

Safety posture:

- a change set is not a database dump;
- raw communication classes reject;
- whole-database copy modes reject;
- operations must be explicitly redacted;
- operation counts are bounded.

### WI028 — Checkpoint and Replay Guard Fixtures

Commit: `7fe1d02 Add checkpoint replay guard fixtures`

Implemented:

- checkpoint identity and lineage checks;
- replay tuple generation;
- duplicate replay rejection;
- stale checkpoint rejection;
- degraded, stale, lost, revoked, wipe-pending, and wiped link rejection;
- redacted rejection reasons.

Safety posture:

- no production network replay store was introduced;
- no private payload is accepted or returned;
- checkpoint lineage must match current accepted state;
- result checkpoints must advance state.

### WI029 — Redacted Linked-Node Audit Fixtures

Commit: `7e491aa Add redacted linked node audit fixtures`

Implemented audit fixtures for lifecycle, link, wipe, policy, envelope, change-set, checkpoint, quarantine, and rollback decisions.

Audit records contain identities, data classes, sync mode, hashes, decision, reason code, redacted reason, timestamp, parent hash, and nonce hash when relevant.

Safety posture:

- audit events are explicitly redacted;
- raw nonce secrets are not recorded;
- private communication data, credentials, tokens, keys, and database dumps reject.

### WI030 — Android Linked-Node Metadata Query

Commit: `28c7777 Add Android linked node metadata query`

Implemented a query path combining Android-local metadata, desktop authority metadata, lifecycle state, capability claims, sync mode, redacted health, private-data lock state, recovery guidance, and lifecycle timestamps.

Covered states:

- local-only;
- linked;
- degraded;
- stale;
- revoked.

Safety posture:

- private change sets remain rejected;
- unsafe desktop status shapes reject;
- private-data behavior cannot be enabled through the fixture shape alone.

### WI031 — Cross-Platform Node Metadata Contracts

Commit: `f7d80c5 Test cross-platform node metadata contracts`

Implemented contract fixtures for Windows, Linux, macOS, Android, and unknown platforms.

Each supported platform can express node identity, platform, device label, link state, trust state, sync mode, capability claims, redacted health, and private-data-disabled state.

Unknown platforms normalize to `unknown`, degrade safely, reduce trust, disable private-data behavior, and retain only bounded read/redacted-health capabilities.

Safety posture:

- no platform-specific private-data shortcut exists;
- credentials, provider secrets, token values, and private keys are unavailable;
- clustering is disabled.

## Validation Evidence

The implementation sequence was repeatedly validated with:

    npm test -- renderer/src/App.test.tsx
    python .local\validate_system.py
    git diff --check

Repository hooks additionally ran:

- RepoPact governance validation;
- work-ledger audit;
- schema-ladder invariant checks;
- Markdown link and `last_verified` checks;
- Electron backend and renderer TypeScript builds;
- renderer Vitest;
- Node backend and contract tests;
- JavaScript syntax checks.

Latest synchronized repository state:

    f7d80c5 Test cross-platform node metadata contracts
    28c7777 Add Android linked node metadata query
    7e491aa Add redacted linked node audit fixtures
    7fe1d02 Add checkpoint replay guard fixtures
    a2749e9 Validate metadata change set fixtures
    31cb8f2 Validate signed link envelope fixtures
    b6f07fb Add private data policy gate helper
    7077482 Implement desktop linked node metadata command
    e60fc44 Add Android local metadata persistence fixture
    6f1d05e Show linked node lifecycle status rows
    56db620 Model redacted linked node lifecycle states

## Completed Foundation

The phase now provides:

- an explicit communication-node lifecycle;
- operator-visible unsafe-state handling;
- Android-local metadata ownership;
- desktop authority metadata access;
- default-deny private-data policy evaluation;
- signed-envelope fixture validation;
- bounded metadata change-set validation;
- checkpoint lineage checks;
- replay rejection;
- redacted audit-event construction;
- Android linked-node metadata querying;
- cross-platform metadata contract parity.

## Remaining Gaps

### Production Cryptography

Not implemented:

- real envelope signing and signature verification;
- production key generation, storage, rotation, and revocation propagation;
- authenticated encryption;
- production canonical serialization verification.

### Production Trust Establishment

Not implemented:

- operator-facing link request workflow;
- cryptographically verified device identity;
- out-of-band verification;
- trust elevation, recovery, relink, and compromised-device handling.

### Production Transport

Not implemented:

- desktop-to-Android and Android-to-desktop transport;
- delivery acknowledgement;
- retry scheduling and offline queues;
- bounded background execution;
- network-loss recovery;
- transport-level replay storage.

### Production Persistence

Not implemented:

- Android production metadata database;
- production replay ledger;
- production checkpoint and audit stores;
- transactional change-set staging;
- quarantine persistence;
- cleanup and retention jobs.

### Production Change-Set Application

Not implemented:

- actual metadata operation application;
- idempotent apply journal;
- conflict quarantine;
- checkpoint commit transaction;
- rollback execution;
- recovery after partial application.

### Operator Surfaces

Not implemented:

- full link-request approval;
- link-policy editor;
- capability review;
- audit-history viewer;
- replay and checkpoint diagnostics;
- quarantine review;
- wipe confirmation and acknowledgement review;
- explicit relink flow.

### Private-Data Readiness

Not implemented:

- approved private-data domains and payload schemas;
- end-to-end encryption;
- encrypted local receipt storage;
- per-domain retention;
- private-content conflict handling and rollback;
- secure wipe verification;
- consent renewal;
- policy-expiry enforcement across transport;
- private-data audit evidence;
- privacy-preserving failure recovery.

## Private-Data Boundary at Closeout

Private communication data remains disabled by default.

The following remain prohibited from linked-node movement:

- raw messages and message bodies;
- contacts and contact details;
- calls and call history;
- attachments;
- raw signal content;
- notification body content;
- credentials;
- provider secrets;
- access tokens;
- private keys;
- whole databases and database dumps.

No implemented helper, fixture, command, query, lifecycle state, platform contract, policy result, envelope result, or change-set result overrides this boundary.

## Readiness Assessment

### Metadata-Only Linked-Node Foundation

Status: **READY FOR CONTINUED HARDENING**

The repository is ready for additional metadata-only implementation work such as production-safe metadata persistence, real metadata transport, cryptographic identity and signing, replay and checkpoint storage, audit-chain persistence, operator link management, metadata conflict quarantine, rollback, and wipe-state workflows.

### Private Communication-Data Movement

Status: **NOT READY**

Private communication-data movement must remain blocked.

The policy-gate helper proves deny-by-default eligibility behavior only. It does not make the system ready to transport private data.

## Recommended Next Phase

Begin a new metadata-only hardening phase:

1. define production linked-node identity and key lifecycle;
2. implement canonical envelope serialization;
3. implement production signature verification;
4. add a persistent replay ledger;
5. add persistent metadata checkpoints;
6. add a linked-node audit-chain store;
7. implement bounded metadata transport;
8. implement metadata change-set staging and quarantine;
9. add operator link and trust-management surfaces;
10. add revocation, wipe, rollback, and recovery integration tests;
11. perform a security and privacy threat review;
12. reassess private-data readiness through a separate explicit gate.

## Final Closeout

WI021 through WI031 are implemented and committed.

The linked-node lifecycle implementation phase is complete.

ForgeLink now has a coherent, tested, metadata-only foundation for linked communication nodes across Windows, Linux, macOS, and Android.

The architecture continues to reject clustering, whole-database copying, automatic trust elevation, broad background synchronization, and private-data movement by default.

The next phase should harden production metadata behavior.

Private communication-data movement remains out of scope and disabled.
