---
audience: maintainers and implementation agents
status: active
last_verified: 2026-09-13
source_of_truth: work/active/032-tauri-production-parity-and-electron-retirement/README.md; work/active/032-tauri-production-parity-and-electron-retirement/work-item.json
---

# Work Item 032: Tauri Production Parity and Electron Retirement

## Goal

Prove production parity for the Tauri 2 desktop shell, establish reproducible Tauri-first
release paths, and remove Electron only after the recorded retirement gate is satisfied.

## Lineage

Completed work item 030 established the shared React/Web cockpit, ForgeLink app bridge,
Tauri desktop and mobile scaffolds, mobile full-cockpit direction, distribution/update
contracts, validation/rollback matrix, and explicit Electron retirement gate.

Work item 030 did not claim full production parity and did not remove Electron. This
item owns the remaining parity evidence and the eventual removal.

## Non-Goals

- Do not remove Electron early merely because Tauri scaffolding launches.
- Do not downgrade Android to an approval-only companion; mobile remains a full cockpit
  where platform capabilities reasonably allow it.
- Do not fork the shared cockpit into unrelated desktop and mobile products.
- Do not replicate the private desktop database onto mobile nodes.
- Do not treat unsigned development/test artifacts as public releases.
- Do not block development evidence on a signing certificate; public signing remains a
  final certificate-gated distribution step coordinated with work item 011 PR-014.

## Priority Order

- [x] **TPR-001** Inventory every Electron-only API, workflow, lifecycle assumption, packaging path, and operator dependency that must be replaced or explicitly retired.
- [x] **TPR-002** Prove onboarding and local-service lifecycle parity in Tauri, including startup, authenticated discovery, port conflicts, bounded restart, clean shutdown, and operator recovery.
- [x] **TPR-003** Prove secure-storage parity for credentials and protected settings without exposing secrets to renderer state, logs, diagnostics, exports, or screenshots.
- [ ] **TPR-004** Prove notifications, deep links, navigation restoration, and single-instance behavior or document platform-specific replacements and limits.
- [ ] **TPR-005** Prove backup, restore, retention, diagnostics, corruption recovery, and data-safety parity without copying the private desktop database to mobile nodes.
- [ ] **TPR-006** Produce reproducible Tauri release artifacts with version metadata, release notes, checksums, update and rollback contracts, and certificate-gated public signing.
- [ ] **TPR-007** Validate a packaged Windows Tauri build through clean-machine or equivalent isolated installation, launch, onboarding, service, cockpit, update, rollback, and uninstall checks.
- [ ] **TPR-008** Record Linux and macOS build, packaging, capability, signing, update, and support posture with tested evidence or explicit bounded limitations.
- [ ] **TPR-009** Remove Electron runtime, packaging, generated renderer assumptions, dependencies, tests, and documentation only after the parity gate is satisfied.
- [ ] **TPR-010** Run post-removal regression, migration, packaged-runtime, rollback, and repository scans proving ForgeLink operates without Electron and can recover from the release transition.
- [ ] **TPR-011** Complete documentation and ledger closeout covering supported platforms, installation, updates, rollback, data safety, known limitations, and remaining risks.

## Electron Removal Gate

Electron may be removed only after TPR-001 through TPR-008 have evidence sufficient to
show that current operator workflows, security boundaries, data-safety behavior,
diagnostics, release mechanics, and rollback paths are preserved or intentionally
replaced.

The removal must be a distinct, reviewable slice with a documented rollback point.

## Security and Data-Safety Constraints

- Credentials stay in approved OS-backed storage and never enter renderer-visible
  diagnostics or public evidence.
- Local private routes remain authenticated.
- Backup, restore, retention, migration, corruption recovery, and rollback must remain
  proven across the shell transition.
- Mobile and linked-node work must not become a database replication shortcut.
- Public update channels must be signed and authenticated before publication.

## Cross-Cutting Definition of Done

- Tauri-first packaged artifacts are reproducible.
- Windows packaged validation is complete; Linux/macOS posture is explicit.
- All Electron-only dependencies and assumptions are inventoried before deletion.
- Actual removal is followed by full regression, repository scans, migration tests,
  packaged-runtime checks, and rollback evidence.
- `python .local/validate_system.py` and every relevant TypeScript, Rust, renderer,
  backend, packaging, and installer check pass.

## Evidence Log

- `20260913-wi032-tpr001-tpr002-lifecycle` — TPR-001 inventory and TPR-002
  desktop lifecycle evidence. The inventory is the durable deletion checklist;
  Rust tests prove real startup/readiness, onboarding guard, authenticated attach,
  timeout, spawn failure, port conflict safety, bounded restart/exhaustion, stop,
  shutdown, recovery, and redaction. A Windows Tauri release build produced MSI
  and NSIS bundles, but clean-machine installation and public signing remain open.
- `20260913-wi032-tpr003-secure-storage` — TPR-003 protected-settings parity.
  Tauri now separates redacted metadata from secret references, stores provider,
  email, push, MCP, agent-channel, local-integration, and linked-node secrets in
  the AES-GCM `FLPSV001` vault wrapped by the OS keyring, and injects only the
  required child-process environment. Renderer tests cover write-only secret
  clearing and canary absence. Electron safeStorage files are preserved and the
  migration conclusion is explicit manual re-entry; no silent credential loss or
  automatic decryption is claimed.
- Existing WI030 Android evidence remains historical foundation input. It proves
  emulator/operator-status inspection only, not packaged mobile app authentication
  or private database replication.
