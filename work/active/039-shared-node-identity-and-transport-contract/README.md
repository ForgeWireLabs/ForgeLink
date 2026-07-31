---
audience: maintainers and implementation agents
status: active
last_verified: 2026-07-31
source_of_truth: work/active/039-shared-node-identity-and-transport-contract/README.md; work/active/039-shared-node-identity-and-transport-contract/work-item.json
---

# Work Item 039: Shared Node Identity and Transport Contract

## Goal

Stop building node identity twice, and give work item 031 a transport *interface* it
currently lacks — without starting a networking product.

This item produces a small shared Rust crate consumed by both ForgeLink and ForgeWire
Fabric: **node identity**, the **canonical envelope**, and a **transport contract**.
It deliberately ships **no connectivity backend**.

## Background

[Decision 0013](../../../decisions/0013-ghost-fabric-channel.md) proposed a
provider-less peer lane so the operator could reach their own nodes from anywhere.
The operator confirmed the need on 2026-07-31 and added a binding constraint: no new
dependency for the operator or a customer, and the same mechanism must serve both
ForgeLink and Fabric.

A ledger review on 2026-07-31 found that building that lane now conflicts with the
project's own sequencing discipline. All five active items (011, 024, 031, 032, 037)
are production-hardening and retirement work, and three channel adapters (020, 021,
022) were deferred on 2026-07-10 with the reason *"higher-priority local-first
adapter, linked-node hardening, and Tauri retirement work should complete before
adding another external provider."* A cross-repo networking layer is a far larger
commitment than any of those adapters. The lane therefore stays deferred in 0013.

Two findings from that review are actionable **now** and are what this item owns:

1. **Node identity is being built twice.** Fabric ships `fabric-identity` —
   *"Durable ed25519 identity management for ForgeWire Fabric nodes"* — while
   ForgeLink's 031/LNH-001 independently builds the same primitive in the Tauri
   shell. Both use `ed25519-dalek`, `sha2`, `base64`, and `zeroize`. Two
   implementations of one security-critical primitive is live duplication and a
   doubled threat surface.
2. **031's transport has no interface.** LNH-007 requires a *"bounded authenticated
   metadata transport"* but nothing defines its shape, so every backend choice stays
   entangled with the connectivity question. Specifying the contract is cheap,
   unblocks 031, and keeps the backend pluggable.

Doing these two first means that if the lane is ever reactivated, the remaining
decision is "which connectivity backend" rather than "build a VPN."

## Architecture Boundary

The shared crate sits **below** both products and owns only:

- **Node identity** — ed25519 keypair lifecycle, public metadata, opaque secure-key
  references. Private key storage stays with each host platform.
- **Canonical envelope** — deterministic bytes, versioning, bounds.
- **Transport contract** — a versioned trait describing a bounded authenticated
  transport, with no implementation of connectivity.

ForgeLink is an **authority node with linked nodes**, not a cluster; Fabric **is** a
cluster (hub, runners, `fabric-store-rqlite`). The crate must serve both without
importing Fabric's cluster assumptions into ForgeLink, or it violates work item 031's
architecture boundary.

## Explicit Non-Goals

- No NAT traversal, hole punching, relay, rendezvous, VPN, or mesh networking.
- No connectivity backend of any kind — not cloudflared, not a hosted relay, not a
  third-party P2P library. Backend selection belongs to the deferred 0013 lane.
- No off-LAN reachability claim in code, docs, or evidence.
- No `rqlite`, Raft, quorum, consensus, clustering, failover, store, or policy
  dependency reaching ForgeLink through the crate.
- No private communication data expressible through the contract before work item
  031 LNH-013.
- No home-rolled cryptography; identity stays on the vetted `ed25519-dalek` stack.
- No rewrite of in-flight 031/LNH-001 desktop vault slices.
- Must not become a blocker or a distraction for 031, 032, or 037.

## Priority Order

- [ ] **SNI-001** Record the shared-crate boundary — what it owns and what it must never import.
- [ ] **SNI-002** Create the companion governed work item in the canonical in-tree Fabric implementation before any Fabric-side change.
- [ ] **SNI-003** Extract the shared ed25519 node identity crate with a deterministic key and serialization contract.
- [ ] **SNI-004** Converge ForgeLink identity onto the crate without regressing shipped LNH-001 desktop behavior.
- [ ] **SNI-005** Prove consumption from both the ForgeLink Tauri shell and the Fabric workspace with pinned versions.
- [ ] **SNI-006** Define the bounded authenticated transport contract, satisfying 031 LNH-007's interface need.
- [ ] **SNI-007** Provide a loopback/LAN reference implementation for tests only.
- [ ] **SNI-008** Prove only approved metadata classes are expressible; private data stays inexpressible until LNH-013.
- [ ] **SNI-009** Define the crate release, versioning, and consumer pinning contract.
- [ ] **SNI-010** Document the boundary and record the identity-convergence threat note.
- [ ] **SNI-011** Prove no block or regression of 031, 032, and 037.

## Sequencing Rules

- **031/LNH-001 desktop slices land first.** Six LNH-001 slices are already
  implemented (vault, rotation, atomic recovery, Tauri orchestration). This item
  extracts a shared core *after* those settle; it does not rewrite them mid-flight.
  The natural convergence point is the remaining mobile keystore adapter work.
- **Fabric changes require a companion in-tree work item first** (work item 037
  rule). Fabric work happens in the canonical `forgewire` monorepo, not the
  standalone `forgewire-fabric` sync mirror.
- **This item is subordinate.** If it contends with 031, 032, or 037 for attention,
  it yields.

## Security and Privacy Constraints

- Private keys stay in OS-backed secure storage and the operator-owned local vault;
  never in the crate's serialized output, renderer state, diagnostics, fixtures,
  logs, evidence, or commits.
- Identity convergence is security-critical: a regression in key handling, rotation,
  or revocation is a security defect, not a refactor bug. SNI-004 requires evidence
  that shipped behavior is preserved.
- The transport contract must make forbidden data classes *inexpressible*, not merely
  rejected at runtime.
- No claim of confidentiality, authentication, or reachability may be documented until
  a backend exists and is tested — this item ships no backend.

## Cross-Cutting Definition of Done

- Every criterion has deterministic automated evidence or a documented bounded manual
  check.
- Identity behavior proven equivalent before and after convergence, including
  rotation, revocation, recovery, and failure paths.
- Both consumers build reproducibly against a pinned crate version.
- ForgeLink still builds and ships if the crate is not adopted (SNI-011).
- Shipped behavior documented under `docs/`; future behavior stays in this item.
- `python .local/validate_system.py`, relevant TypeScript/Rust tests, and integration
  checks pass.

## Evidence Log

| Date | Criterion | Evidence | Result |
| --- | --- | --- | --- |
| 2026-07-31 | — | Item created from the 2026-07-31 ledger review. Rescoped from its original provider-less-peer-lane framing after the review found that lane conflicts with current sequencing; see [decision 0013](../../../decisions/0013-ghost-fabric-channel.md). ID 039 preserved. No implementation started. | Ledger entry only. |
