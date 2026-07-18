---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-18
source_of_truth: work/completed/033-canonical-dashboard-integrity/README.md; work/completed/033-canonical-dashboard-integrity/work-item.json
---

# Work Item 033: Canonical Dashboard Integrity

## Goal

Make it impossible for ForgeLink's authoritative validation and git gates to pass
while `audits/reports/dashboard.md` differs from RepoPact's canonical projection of
the current governed records.

## Scope

- Pin the upstream RepoPact dashboard-integrity implementation.
- Regenerate the ForgeLink dashboard from current source records.
- Prove stale-output rejection and repair against ForgeLink itself.
- Align validation messages and governing documentation with the pinned package.

## Acceptance Criteria

- [x] **CDI-001** Pin the upstream RepoPact commit containing deterministic dashboard
  validation.
- [x] **CDI-002** Prove deliberate stale output fails and regeneration restores a pass.
- [x] **CDI-003** Align ForgeLink's validation entry point, governing documentation,
  and generated output with the pin.
- [x] **CDI-004** Record reproducible evidence and reconcile this item to completed.

## Safety and Rollback

The validator remains read-only. `repopact dashboard` may overwrite only the derived
dashboard. Rollback is the prior package pin plus prior dashboard, but that reopens the
known stale-derived-output integrity gap and should be used only for emergency package
compatibility recovery.

## Evidence Log

| Date | Evidence | Result |
| --- | --- | --- |
| 2026-07-18 | `20260718-canonical-dashboard-integrity` | RepoPact `126264a` installed; the stale ForgeLink dashboard failed validation; canonical regeneration restored a pass; the upstream 101-test suite passed. |

## Closeout

ForgeLink now consumes RepoPact's canonical derived-dashboard enforcement. The
dashboard has no run-date churn, exact divergence is a validation error, RepoPact
mutation/repair commands refresh it, and ForgeLink's pre-commit/pre-push audit cannot
report success while the checked-in dashboard is stale.
