# WI011 Competitive Parity Amendment — 2026-09-11

## Scope

The canonical acceptance state remains in `work-item.json`. This amendment records why PR-017 through PR-021 were added after the September 2026 ForgeWire ecosystem review.

ForgeLink already has a strong local-first communications and human-authority architecture. The remaining production-parity gaps are not basic messaging features; they are the harder identity, authority, cross-device, and operational-proof requirements needed before making a stronger production/SOTA claim.

## Added release gates

- **PR-017 — cryptographic human-decision identity.** Bind high-value approval/denial records to request/evidence/outcome plus operator and key/device identity, with rotation/revocation/recovery and replay verification. Keep tamper evidence, signature verification, and legal non-repudiation distinct.
- **PR-018 — local + federated human principal model.** Preserve account-free local use while allowing optional enterprise identity adapters and scoped roles without making an external IdP a product prerequisite.
- **PR-019 — step-up and authority freshness.** High-risk approval requires current authority independently of notification urgency or attention policy.
- **PR-020 — cross-device decision integrity.** Desktop/mobile decision state must handle offline use, expiry, duplicate/conflicting actions, clock skew, revoked credentials, and reconnect without manufacturing authority from stale state.
- **PR-021 — reliability/chaos evidence.** Exercise provider disorder, restart, network loss, approval expiry, callback retry, linked-node loss, and recovery while proving idempotent side effects and complete audit outcome.

## Existing work-item ownership

These are release gates, not permission for WI011 to create competing implementations:

- WI031 and WI039 remain authoritative for linked-node metadata/transport/trust and shared node identity/transport contracts.
- WI032 remains authoritative for Tauri production parity and Electron retirement.
- Existing ForgeLink agent identity, Human Card, decision/audit, communication firewall, attention, and provider subsystems remain the product owners of their current state.

If implementation work needs a narrower child WI, create it from the owning subsystem rather than moving that subsystem into WI011.

## Product rule

Competitive parity is the minimum acceptable outcome where a capability belongs in ForgeLink's role. ForgeLink does not need to imitate hosted communication suites when its local-first human-authority model provides a stronger outcome. That stronger outcome must still be executable, tested, recoverable, and evidenced before it counts as parity closure.
