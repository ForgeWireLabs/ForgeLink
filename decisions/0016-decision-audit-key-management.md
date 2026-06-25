---
id: 0016
title: Decision/Audit Key Management and the Audit Chain's Integrity Guarantee
status: accepted
date: 2026-06-24
supersedes: []
---

# 0016: Decision/Audit Key Management and the Audit Chain's Integrity Guarantee

## Context

Work item 016 builds a governed decision loop: structured approval requests
(AGH-006), evidence packs (AGH-007), decision records (AGH-013), outcomes
(AGH-015), and a tamper-evident audit chain (AGH-016). The chain links each record
to the previous one by SHA-256 hash. AGH-025 requires us to state, honestly, what
integrity that actually provides, and to define how keys and device identities are
generated, stored, rotated, revoked when a device is lost, and recovered.

It is important not to overclaim. The hash-linked chain is **local
tamper-evidence**, not cryptographic non-repudiation: anyone who can rewrite the
whole local database can recompute every hash. The chain's value is that a
*partial* or *after-the-fact* edit to any single record or entry is detectable on
verification, and that the records bind together (a decision commits to the exact
request and evidence hashes it decided on).

## Decision

1. **State the guarantee plainly.** The audit chain provides **local, append-only
   tamper-evidence**: `verifyAuditChain` recomputes every entry and payload and
   reports the first broken link, tampered entry, or tampered payload. It does
   **not** provide non-repudiation or protection against an attacker who controls
   the whole local store. Documentation must not imply otherwise.

2. **Device identity registry, keys out of the database.** A `device_keys` registry
   (schema v23) records device identities, their public-key references, trust
   state, and rotation/revocation timestamps. Private keys are generated and held
   in **OS-backed secure storage** (Electron `safeStorage`) in the main process and
   are **never** written to the SQLite database, exports, logs, or diagnostics.

3. **Rotation keeps identity, history survives revocation.** Rotating a device
   swaps its public key while keeping the device identity and its past decision
   records. **Lost-device revocation** marks the device revoked so it can no longer
   attribute new decisions; its prior decision records remain in the chain (history
   is never rewritten).

4. **Recovery is re-registration, not key escrow.** ForgeLink does not escrow
   private keys. Recovery after device loss is: revoke the lost device, then
   register the replacement device (new key) from the operator surface. Past
   records stay attributed to the now-revoked device.

5. **Optional, single-operator-friendly.** Decisions still default to
   `operator:primary` with no device configured; the registry is available when an
   operator wants per-device attribution and revocation, and is a prerequisite for
   the mobile companion's signed decisions (017).

## Alternatives considered

- **Claim cryptographic non-repudiation.** Rejected: false for a local hash chain;
  it would mislead operators about the guarantee.
- **Store private keys in the database (even encrypted).** Rejected: OS-backed
  secure storage is the right home; the DB holds only public references.
- **Per-decision signatures now.** Deferred: the registry and guarantee come first;
  signing decision hashes with device keys can build on this registry later without
  a schema change to the chain.

## Consequences

- AGH-025 ships the registry (register/rotate/revoke) and this honest statement of
  the guarantee; the audit chain's wording across docs is aligned to "local
  tamper-evidence."
- The mobile companion (017) and any future signed-decision work build on the
  device registry rather than introducing a parallel key store.
