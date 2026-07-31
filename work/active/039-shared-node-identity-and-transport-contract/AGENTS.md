# Shared Node Identity and Transport Contract Agent

## Scope

- Own the shared crate boundary, the ed25519 node identity extraction, ForgeLink's
  convergence onto it, the canonical envelope, the bounded authenticated transport
  contract, a test-only loopback/LAN reference implementation, the crate release and
  pinning contract, docs, and the identity-convergence threat note.
- Coordinate with work item 031 for identity, envelope, and transport primitives;
  with 030/decision 0017 for the shell boundary; and with 037 for the cross-repo
  Fabric rule.

## Prohibited Work

- Do not implement NAT traversal, hole punching, relays, rendezvous, VPN, or mesh
  networking. This item ships no connectivity backend.
- Do not select or integrate a connectivity backend (cloudflared, hosted relay,
  third-party P2P library). That belongs to the deferred lane in decision 0013.
- Do not claim off-LAN reachability in code, docs, tests, or evidence.
- Do not let `rqlite`, Raft, quorum, consensus, clustering, failover, store, or policy
  dependencies reach ForgeLink through the crate.
- Do not design or implement custom cryptography; identity stays on `ed25519-dalek`.
- Do not rewrite in-flight work item 031 LNH-001 desktop vault slices.
- Do not make private communication data expressible through the transport contract
  before 031 LNH-013 is recorded with evidence.
- Do not change Fabric before the companion in-tree work item exists (SNI-002); Fabric
  work happens in the canonical `forgewire` monorepo, never the standalone
  `forgewire-fabric` sync mirror.
- Do not place private keys, secret material, or message bodies in renderer state,
  tests, diagnostics, logs, screenshots, reports, or commits.
- Do not block or destabilize work items 031, 032, or 037 to advance this one.

## Required Checks

- Read the root and nested `AGENTS.md` files before mutation.
- Run `python .local/validate_system.py` after ledger, schema, policy, audit, or docs
  changes.
- Run targeted Rust and TypeScript tests for implementation changes, on both consumers
  where the crate is involved.
- Prove identity behavior equivalence across convergence — creation, rotation,
  revocation, recovery, rollback, and failure paths — before closing SNI-004.
- Verify serialized identity output contains no private key material before closing
  SNI-003.
- Verify ForgeLink still builds and ships without the crate before closing SNI-011.

## Definition of Done

A criterion closes only with implementation, deterministic evidence, documentation,
rollback notes, limitations, and remaining-risk notes. Completion of this item
authorizes neither off-LAN connectivity nor private-data movement.
