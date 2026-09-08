# Shared Node Identity and Transport Boundary

This document is the binding architecture boundary for the shared Rust crate planned
by work item 039. The crate is a product-neutral protocol primitive consumed by
ForgeLink and ForgeWire Fabric. It is not a service, store, policy engine, cluster
component, or connectivity product.

No shared crate implementation or Fabric-side change is authorized by this document.
Fabric work remains gated on SNI-002, and crate extraction remains gated on SNI-003.

## Owned surface

The crate may own only these three capabilities:

1. **Node identity primitives**
   - Ed25519 public identity metadata and deterministic fingerprints.
   - Versioned public serialization.
   - Opaque secure-key references supplied by a host.
   - Key lifecycle value types needed to describe creation, rotation, revocation,
     replacement, and recovery without storing private key material.
   - Signing and verification operations whose private-key access is supplied through
     a narrow host-owned abstraction.
2. **Canonical envelope primitives**
   - Deterministic, versioned envelope bytes.
   - Explicit size, version, timestamp, nonce, sender, recipient, capability, and
     metadata-class bounds.
   - Signature input construction and signature verification.
   - Metadata-only payload types approved by work item 031.
3. **Bounded authenticated transport contract**
   - A versioned Rust trait describing send, receive, acknowledgement, rejection, and
     transport-health outcomes for canonical envelopes.
   - Error and capability types that do not assume a particular network backend.
   - Test seams that permit an in-memory or loopback/LAN-only reference adapter under
     SNI-007.

## Host-owned responsibilities

The crate must depend on host abstractions for the following. These responsibilities
remain in ForgeLink, Fabric, or their platform adapters:

- private-key generation, persistence, lookup, deletion, rotation orchestration, and
  OS-backed secure storage;
- authorization, trust, consent, attention, approval, and communication policy;
- replay databases, checkpoints, durable audit records, quarantine, retention, wipe,
  rollback, and recovery orchestration;
- databases, queues, cluster membership, scheduling, failover, and service lifecycle;
- network listeners, sockets, discovery, routing, tunneling, relay selection, NAT
  traversal, and connectivity credentials;
- product-specific diagnostics, UI, operator workflows, and provider integrations.

The crate may describe an operation or outcome without owning the host system that
persists, authorizes, transports, or presents it.

## Forbidden imports and assumptions

The crate must never import or depend on:

- `rqlite`, Raft, quorum, consensus, cluster membership, leader election, replication,
  failover, or any Fabric store or policy package;
- SQLite, database drivers, object stores, durable queues, or product persistence;
- ForgeLink backend, renderer, shell, provider, messaging, contacts, voice, or policy
  modules;
- Fabric hub, runner, scheduler, store, provider, policy, or deployment modules;
- connectivity backends or SDKs, including relay, rendezvous, VPN, mesh, tunnel, NAT
  traversal, hole-punching, or hosted transport clients;
- telecom, email, push, webhook-tunnel, or public-cloud provider SDKs;
- Tauri, Electron, Android, iOS, Windows credential-manager, macOS Keychain, or Linux
  secret-service implementations.

It must not assume that ForgeLink is a cluster, that Fabric policy applies to
ForgeLink, that a successful signature grants authorization, or that a linked node may
carry private communication data.

## Dependency direction

Dependency flow is one way:

```text
ForgeLink host adapters ─┐
                         ├──> shared node crate ──> vetted primitive libraries
Fabric host adapters ────┘
```

The shared crate cannot depend back on either consumer. Cross-consumer behavior is
expressed through versioned public types and host-supplied traits, not feature flags
that import product code.

Vetted primitive dependencies may include narrowly scoped cryptography,
serialization, hashing, zeroization, and error/type libraries. Every dependency must
be justified by an owned capability above. A dependency that implements persistence,
policy, clustering, or connectivity is outside the boundary even if optional or
disabled by default.

## Security and privacy invariants

- Serialized identity output contains public metadata and opaque references only;
  never private key bytes, seed material, wrapping keys, or recoverable secrets.
- Debug and display output must be safe by construction and must not reveal private
  material supplied by a host.
- Signature validity proves integrity and possession only. Host authorization,
  capability, replay, lifecycle, and policy checks remain mandatory.
- Envelope payload types remain metadata-only until work item 031 LNH-013 records an
  evidence-backed decision authorizing any broader data class.
- The contract makes no confidentiality, delivery, availability, or off-LAN
  reachability claim. Those properties require a separately selected and tested
  backend, which work item 039 does not provide.

## Enforcement required by later slices

SNI-003 through SNI-011 must turn this recorded boundary into deterministic checks:

- dependency inspection rejects forbidden product, persistence, cluster, policy, and
  connectivity packages;
- serialization and debug-output tests prove private material is absent;
- compile-time payload types admit only approved metadata classes;
- both consumers pin the shared crate without reverse dependencies;
- the test reference adapter is visibly test-only and loopback/LAN-scoped;
- release documentation repeats that the crate ships no connectivity backend.

Any proposal to add store, policy, cluster, failover, connectivity, or private-data
behavior requires a new governed decision and work-item scope. It cannot be smuggled
into the shared crate as a convenience dependency.

## Rollback and limitations

This slice changes documentation and governed criterion state only. Rollback consists
of reverting this document and reopening SNI-001; it changes no runtime, package,
database, key, transport, or consumer behavior.

The boundary is necessary but not executable enforcement. Until later criteria add
the crate and its checks, reviewers must apply it manually. It does not satisfy the
Fabric companion-item gate, identity extraction, consumer convergence, transport
trait, or any connectivity requirement.
