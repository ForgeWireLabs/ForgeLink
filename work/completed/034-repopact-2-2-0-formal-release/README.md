---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-18
source_of_truth: work/completed/034-repopact-2-2-0-formal-release/README.md; work/completed/034-repopact-2-2-0-formal-release/work-item.json
---

# Work Item 034: Adopt RepoPact 2.2.0 Formal Release

## Goal

Replace ForgeLink's interim exact-commit dependency with the formal, hash-verified
RepoPact 2.2.0 PyPI release while retaining the canonical dashboard-integrity gate
proved by work item 033.

## Scope

- Pin `repopact==2.2.0` in `requirements-repopact.txt`.
- Align the root contract, local-extension inventory, version marker, decision 0015,
  work ledger, generated dashboard, and evidence.
- Install from the public index without cache and run ForgeLink's governed gates.

## Acceptance Criteria

- [x] **RP220-001** Replace the interim git commit dependency with exact PyPI pin
  `repopact==2.2.0` and align governing documentation.
- [x] **RP220-002** Verify the public package and upstream `v2.2.0` tag identify the
  dashboard-integrity release and its published artifacts.
- [x] **RP220-003** Pass canonical dashboard generation, ForgeLink governance
  validation, and the full pre-push gate with the formal release installed.
- [x] **RP220-004** Record reproducible evidence and reconcile the ledger to completed.

## Safety and Rollback

The source ledger and schemas remain unchanged. Rollback to the interim commit pin is
possible if package installation fails, but would abandon the formal-release identity
without changing validator semantics and must be recorded as a new exception.

## Evidence

`20260718-repopact-2-2-0-formal-release` records the no-cache public-index install,
package/tag/hash identity, canonical generation, ForgeLink governance validation, and
complete pre-push gate.

## Closeout

ForgeLink now consumes exact PyPI release `repopact==2.2.0`. The public artifacts
match the upstream release-candidate hashes, and the same validator behavior proved in
work item 033 remains active under a formal package version.
