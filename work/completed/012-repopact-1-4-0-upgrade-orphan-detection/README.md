---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-17
source_of_truth: AGENTS.md; decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md
---

# Work Item 012: Upgrade vendored RepoPact to 1.4.0 and close the orphan-work-dir blind spot

## Goal

Bring the vendored RepoPact tooling up to the published 1.4.0 release and add the
drift detection that 1.4.0 still lacks, so that a future adopter cannot repeat the
failure that hid `work/001-production-readiness` from the validator and dashboard.

## Why

While reconciling stale trackers (work item 011) we found that the
production-readiness plan lived under `work/` with a `README.md` and `_audit/`
companion but **no `work-item.json`**. RepoPact discovers work only at
`work/<status>/<name>/work-item.json` (RepoPact's `repo_model.py`),
so the validator passed and the dashboard reported `active: 0` while real,
load-bearing planning sat invisible. The published 1.4.0 `doctor` catches stale
registry paths, unregistered contracts, and incomplete `_audit` companions, but
nothing in 1.4.0 flags a manifest-less work directory or a dead `source_of_truth`
pointer. That is the gap this item closes.

## Scope

- **Upgrade (no clobber).** Vendored base is already ~1.4.0 for most files; only
  the three new tools and three refreshed modules are missing. The local preflight
  extension (`validate_repo.py`, `work-item.schema.json`) must survive the upgrade.
- **New knowledge.**
  - `validate_repo.py`: hard error for any `work/` directory with planning content
    and no `work-item.json` (invisible to ledger/dashboard violates INV-1).
  - `doctor.py`: warn for `source_of_truth` frontmatter pointing at missing paths.
- Capture the local-vs-upstream divergence in a decision record.

## Acceptance

Lifecycle and evidence links live in [`work-item.json`](work-item.json).

## Closeout

- Vendored tooling moved to 1.4.0; `doctor`/`takeover`/`track` available via the CLI.
- `validate_repo.py` now rejects orphan work directories; `doctor` warns on dead
  `source_of_truth` pointers; negative test confirms the orphan check fires.
- Repository validates and `repopact doctor` reports healthy.
- Divergence recorded in
  [decision 0002](../../../decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md).
