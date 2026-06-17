---
id: 0002
title: Vendor RepoPact 1.4.0 with Local Preflight and Orphan-Detection Extensions
status: accepted
date: 2026-06-17
supersedes: []
---

# 0002: Vendor RepoPact 1.4.0 with Local Preflight and Orphan-Detection Extensions

## Context

ForgeLink does not `pip install repopact`; it **vendors** RepoPact's schemas and
tooling under `schemas/` and `scripts/` so the governance layer travels with the
repository and runs on a clean machine. The published release on PyPI is now
**1.4.0**, which adds `repopact doctor` (drift diagnosis and safe `--fix`),
`repopact takeover` (retire legacy plan directories RepoPact has fully imported),
`track_import.py`, and refreshed `adopt_repo.py` / `plan_import.py`.

Two local needs sit on top of upstream:

1. **Preflight marker** (work item 010): work items `010+` must declare they were
   created before implementation started. This is a local extension of
   `validate_repo.py` and `work-item.schema.json` that upstream does not carry.
2. **Orphan / dead-pointer detection** (work item 012): while reconciling stale
   trackers we found `work/001-production-readiness` had a `README.md` and
   `_audit/` companion but no `work-item.json`. RepoPact discovers work only at
   `work/<status>/<name>/work-item.json`, so the validator passed and the
   dashboard showed `active: 0` while real planning was invisible. Even 1.4.0's
   `doctor` does not flag a manifest-less work directory or a dead
   `source_of_truth` pointer.

## Decision

Vendor RepoPact **1.4.0** and keep two ForgeLink-local extensions on top of it:

- **Preserve the preflight extension** in `scripts/validate_repo.py`
  (`validate_work_preflight`, `PREFLIGHT_REQUIRED_FROM_ID`) and the `preflight`
  property in `schemas/work-item.schema.json`. These are intentional local
  additions; `repopact doctor` will report `work-item.schema.json` as
  `schema-differs` and must not auto-overwrite it.
- **Add orphan/dead-pointer detection.**
  - `validate_repo.validate_orphan_work_dirs`: a hard error when a directory
    under `work/` carries planning content (README/AGENTS/`_audit`) but no
    `work-item.json`. Invisible load-bearing planning breaks INV-1, so it fails
    validation rather than merely warning.
  - `doctor._dead_source_of_truth`: a warning when a record's `source_of_truth`
    frontmatter names a path-like target that does not exist.

These extensions are candidates to upstream to
[ForgeWireLabs/repopact](https://github.com/ForgeWireLabs/repopact); until then
they live only in the vendored copy.

## Alternatives considered

- **Replace the vendored tree wholesale with 1.4.0.** Rejected: it would clobber
  the preflight extension in `validate_repo.py` and `work-item.schema.json`.
- **Put orphan detection only in `doctor`.** Rejected: `doctor` is advisory and
  not on the required gate, so `validate` would still pass over an invisible
  tracker — the exact failure being fixed. Orphan detection must be a hard
  validation error; the softer, false-positive-prone dead-pointer check stays a
  `doctor` warning.
- **Stay on the pre-1.4.0 vendored tooling.** Rejected: it lacks `doctor` and
  `takeover`, the tools that make this class of drift visible and recoverable.

## Consequences

- A manifest-less planning directory under `work/` now fails `validate`, so the
  blind spot that hid the production-readiness tracker cannot recur silently in
  ForgeLink or any repository that adopts these checks.
- `repopact doctor` / `repopact takeover` are available; the correct future path
  for migrating a legacy plan tree is `import-plan` (which records a `source`
  provenance field) followed by `takeover`, not a manual move.
- Re-syncing with a future upstream RepoPact is a three-way merge: take upstream,
  re-apply the preflight extension and the orphan/dead-pointer checks, and keep
  the local `preflight` property in `work-item.schema.json`.
