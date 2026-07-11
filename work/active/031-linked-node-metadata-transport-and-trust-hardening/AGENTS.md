# Linked-Node Metadata Transport and Trust Hardening Agent

## Scope

- Own production identity, canonical envelope serialization, signing/verification,
  durable replay/checkpoint/audit storage, bounded metadata transport, quarantine,
  lifecycle integration, operator trust controls, and threat review.
- Coordinate with completed work item 030 for Tauri bridge boundaries and with work
  items 015-017 for communication, governance, redaction, and operator experience.

## Prohibited Work

- Do not move private communication payloads.
- Do not copy or replicate any database.
- Do not introduce rqlite, Raft, quorum, consensus, clustering, HA, or failover.
- Do not treat pairing, linking, metadata sync, or signature validity as consent.
- Do not place credentials, provider secrets, tokens, or private keys in renderer
  state, tests, diagnostics, logs, screenshots, reports, or commits.

## Required Checks

- Read the root and nested `AGENTS.md` files before mutation.
- Run `python .local/validate_system.py` after ledger, schema, policy, audit, or docs
  changes.
- Run targeted TypeScript/Rust tests plus metadata-only end-to-end integration tests
  for implementation changes.
- Prove replay, stale, revoked, wipe, rollback, corruption, quarantine, and recovery
  failure paths before closing affected criteria.

## Definition of Done

A criterion closes only with implementation, deterministic evidence, redacted audit
proof, documentation, rollback notes, limitations, and remaining-risk notes. Completion
of this item does not authorize private-data movement.
