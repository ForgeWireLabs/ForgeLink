---
id: 0018
title: The Signing Certificate Is a Public-Distribution Gate, Not a Development Blocker
status: accepted
date: 2026-06-30
supersedes: []
---

# 0018: The Signing Certificate Is a Public-Distribution Gate, Not a Development Blocker

## Context

Work item 011 PR-014 establishes ForgeLink releases. Everything in PR-014 that does
not require a certificate has landed (real icon, installer, checksums, version
metadata, release notes, the reproducible release checklist, auto-update wiring,
electron-updater asar bundling, and `npm run release:check`). The remaining work is
**operator/cert-gated**: an operator-provided code-signing certificate
(Windows Authenticode / Apple Developer-ID) and the signed `latest.yml` auto-update
feed, which is held until signing so clients are never on an unauthenticated channel.

Operator direction (Jeremy, 2026-06-30): the signing certificate will likely not be
available until well after the rest of the project is complete. Earlier framing —
and several status reports — treated PR-014/signing as a gate that blocks work item
030 (Tauri shared shell) and the 019–024 channel adapters. That coupling would stall
development for an external dependency, which is not acceptable.

Note that the work ledger already states `depends_on` means an item must respect the
upstream item's boundaries and decisions, **not** that work is strictly sequential
(see `work/README.md`). 030's `depends_on: ["011", ...]` was therefore never a hard
block; this decision makes that explicit and removes the stale "blocked on signing"
language.

## Decision

1. **Signing is a public-distribution / release-hardening gate, not a
   development blocker.** A code-signing certificate and a signed update feed gate
   *signed public distribution* only. They do not gate product development,
   scaffolding, validation, or internal/dev distribution.
2. **011 PR-014 stays active with cert-limited scope.** Its non-cert work is done;
   the certificate and signed feed remain pending as an explicit **external
   dependency**. 011 is not deferred or blocked — it is complete except for that
   dependency, revisited when the certificate arrives.
3. **030 may proceed on an unsigned/dev distribution path.** Tauri architecture
   (TAURI-001), the app-bridge (TAURI-002), desktop/mobile scaffolding
   (TAURI-003/004), and validation (TAURI-007) all run on unsigned/dev builds. Only
   *signed public distribution* (TAURI-006) and any release-critical signed-install
   integration in the Electron-retirement gate (TAURI-005) eventually require the
   certificate.
4. **The adapter roadmap (019–024) does not wait on signing.** Channel adapters are
   backend/renderer features independent of distribution signing.
5. **Preserve the working unsigned/dev installer path.** `npm run build` already
   produces an installable (unsigned) build; that path remains the development and
   internal-distribution mechanism until signing is available.
6. **Revisit signing later as public-distribution hardening.** When the operator
   provides a certificate, finish PR-014 (sign installers, publish `latest.yml`) and,
   if useful at that time, split the certificate-acquisition/signed-feed work into a
   dedicated deferred work item.

## Consequences

- Stale "030 is blocked on the signing cert" language is removed from the 030 work
  item, its AGENTS.md, and `docs/distribution-and-update-strategy.md`; 030's
  near-term gate is restated as "unsigned/dev Tauri scaffolding is acceptable."
- 011 PR-014 remains pending solely on the operator-provided certificate and signed
  feed, documented as an external dependency rather than a project blocker.
- The distribution strategy distinguishes **dev/unsigned distribution** (available
  now; unblocks 030 and the adapters) from **signed public distribution**
  (cert-gated; later hardening).
- Project sequencing proceeds: 019–024 adapters and 030 scaffolding continue without
  waiting on signing.
