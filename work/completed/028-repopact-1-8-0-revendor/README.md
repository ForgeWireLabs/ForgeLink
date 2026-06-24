---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-24
source_of_truth: README.md; work-item.json
---

# Work Item 028: Re-vendor RepoPact 1.8.0

## Goal

Bring the vendored RepoPact tree up to **1.8.0** and retire the interim local
`deferred` decision-status carry, now that `deferred` and `rejected` ship natively
upstream (RepoPact decision 0017, ForgeLink decision [0014](../../../decisions/0014-deferred-decision-status.md)).

## Background

ForgeLink contributed its `deferred` need upstream rather than carrying a vendored
patch indefinitely. RepoPact 1.8.0 added `deferred` and `rejected` to the decision
status vocabulary. This item pulls that release into the vendored copy and drops the
carry, following the re-vendor pattern of work items 026 (1.5.0) and 027 (1.6.0).

## Scope

Re-vendored from `C:\Projects\repopact` at 1.8.0:

- **Taken wholesale** (no ForgeLink carry): `scripts/plan_import.py`,
  `scripts/takeover.py`, `scripts/track_import.py`,
  `schemas/record-frontmatter.schema.json`.
- **Adopted native vocabulary, preserved preflight**: `scripts/validate_repo.py`
  (`DECISION_STATUSES` now `proposed | accepted | rejected | deferred | superseded |
  deprecated`; `PREFLIGHT_REQUIRED_FROM_ID` / `validate_work_preflight` kept).
- **Unchanged** (already matched 1.8.0 + carry): `schemas/work-item.schema.json`
  (preflight property), `scripts/generate_dashboard.py`.
- **Pins**: `scripts/REPOPACT_VERSION` and `requirements-repopact.txt` → 1.8.0;
  `audits/registry.json` note → 1.8.0.
- **Registry**: `scripts/LOCAL_EXTENSIONS.md` — `deferred` moved from carried to
  graduated; only the preflight marker remains a carried patch.

## Non-goals

- No change to the schema-migration ladder, application code, or any work item's
  acceptance state.
- The remaining `preflight` carry stays (still ForgeLink-only).

## Closeout

| Criterion | Evidence |
| --- | --- |
| RVN-001 re-vendored 1.8.0 + pins | [20260624-028-repopact-1-8-0-revendor](../../../evidence/runs/20260624-028-repopact-1-8-0-revendor.json) |
| RVN-002 dropped deferred carry; registry updated | [20260624-028-repopact-1-8-0-revendor](../../../evidence/runs/20260624-028-repopact-1-8-0-revendor.json) |
| RVN-003 validators pass; 0013 deferred validates natively | [20260624-028-repopact-1-8-0-revendor](../../../evidence/runs/20260624-028-repopact-1-8-0-revendor.json) |

All acceptance criteria satisfied with evidence; directory moved to `work/completed/`.
