---
audience: maintainers and implementation agents
status: active
last_verified: 2026-07-10
source_of_truth: work/active/031-linked-node-metadata-transport-and-trust-hardening/README.md; work/active/031-linked-node-metadata-transport-and-trust-hardening/work-item.json
---

# Work Item 031: Linked-Node Metadata Transport and Trust Hardening

## Goal

Move ForgeLink's completed metadata-only linked-node fixtures into a production-grade,
bounded trust and transport layer without enabling private communication-data movement.

## Background

The LNI-001 through LNI-012 implementation slices established lifecycle models,
operator-visible status, Android-local metadata persistence, desktop metadata commands,
deny-by-default policy gates, signed-envelope and change-set fixtures, replay/checkpoint
guards, redacted audits, Android queries, and cross-platform contracts.

Those slices deliberately stopped before production identity, cryptography, durable
replay/checkpoint/audit storage, authenticated transport, quarantine, rollback, wipe,
and recovery. This item owns that missing middle.

## Architecture Boundary

ForgeLink devices are communication nodes. Each node owns its own local data.
Linked-node transport is metadata-first, signed, capability-scoped, replay-protected,
checkpoint-bound, policy-gated, lifecycle-aware, operator-visible, and audit-linked.

This is not a cluster, distributed database, failover topology, or automatic trust
relationship.

## Explicit Non-Goals

- No raw messages, message bodies, contacts, contact details, calls, call history,
  attachments, signal content, notification body content, credentials, tokens,
  provider secrets, private keys, database files, or database dumps.
- No rqlite, Raft, quorum, consensus, clustering, distributed SQLite, HA, or failover.
- No broad background synchronization.
- No private-data permission inferred from pairing, linking, metadata sync, or a
  successful signature.
- No automatic enablement of private-data transport when this item closes.

## Priority Order

- [ ] **LNH-001** Implement production node identity and device-key lifecycle with explicit creation, storage, rotation, revocation, and recovery boundaries.
- [ ] **LNH-002** Define canonical linked-node envelope serialization with deterministic bytes, versioning, bounds, and compatibility tests.
- [ ] **LNH-003** Implement production signing and signature verification without placing private keys or secret material in renderer state, diagnostics, fixtures, or logs.
- [ ] **LNH-004** Implement durable replay protection that survives restart and rejects duplicate, expired, stale, revoked, and wipe-state envelopes.
- [ ] **LNH-005** Persist metadata-only checkpoints with lineage, idempotency, corruption detection, bounded retention, and rollback-safe recovery.
- [ ] **LNH-006** Persist a redacted audit chain for lifecycle, policy, envelope, change-set, quarantine, replay, checkpoint, wipe, rollback, and recovery decisions.
- [ ] **LNH-007** Implement a bounded authenticated metadata transport that permits only approved metadata classes and never copies a database or private communication payload.
- [ ] **LNH-008** Implement metadata change-set staging, idempotency, validation, quarantine, acknowledgement, and rejection handling.
- [ ] **LNH-009** Add operator-visible trust, link, revoke, relink, capability, lifecycle, and recovery surfaces with deny-by-default actions.
- [ ] **LNH-010** Integrate revocation, wipe, rollback, stale, lost, degraded, and recovery behavior across transport, persistence, audit, and operator surfaces.
- [ ] **LNH-011** Add end-to-end metadata-only integration tests across desktop and Android-linked-node fixtures and supported platform contracts.
- [ ] **LNH-012** Complete a security and privacy threat review covering identity, cryptography, replay, transport, storage, audit, revocation, wipe, rollback, recovery, and operator error.
- [ ] **LNH-013** Record a separate evidence-based private-data readiness decision; completing this item must not enable private communication-data movement automatically.

## Security and Privacy Constraints

- Production private keys must remain outside renderer state and public evidence.
- Every accepted envelope and change set must be authenticated, authorized, bounded,
  replay-checked, checkpoint-checked, policy-checked, and auditable.
- Unsafe lifecycle states must deny or quarantine operations instead of silently
  continuing.
- Audit output must remain redacted and must not reconstruct private communication
  content.
- Wipe, revocation, rollback, recovery, and stale/lost handling must be tested as one
  integrated lifecycle, not as isolated happy-path helpers.

## Cross-Cutting Definition of Done

- Every criterion has deterministic automated evidence or a documented bounded manual
  check.
- Failure, corruption, replay, stale, revoked, wipe, rollback, and recovery paths are
  covered.
- Current shipped behavior is documented under `docs/`; future behavior remains here.
- `python .local/validate_system.py`, relevant TypeScript/Rust tests, and integration
  checks pass.
- A separate private-data readiness decision is recorded. The default remains disabled.

## Evidence Log

No implementation evidence yet. This item was created before production hardening work
begins.
