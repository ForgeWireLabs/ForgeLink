---
id: 0012
title: RepoPact 1.5.0 Upgrade and Single-Authoritative-Validator Architecture
status: accepted
date: 2026-06-22
supersedes: []
---

# 0012: RepoPact 1.5.0 Upgrade and Single-Authoritative-Validator Architecture

## Context

ForgeLink vendors RepoPact (`scripts/` + `schemas/`), previously pinned at 1.4.0
(`audits/registry.json` still said 1.2.0). Two problems had accumulated:

1. **The version was behind.** The vendored `validate_repo.py` and
   `work-item.schema.json` were already 1.5.0-equivalent plus ForgeLink's local
   `preflight` extension, but the CLI tooling scripts (`init_repo`, `new`,
   `takeover`, `generate_spec`, `generate_dashboard`, `doctor`, `repopact_cli`,
   `repo_model`) were 1.4.0.

2. **The two validators had diverged.** The vendored `validate_repo.py` was
   failing 14 ways while the lighter `.local/validate_system.py` passed. The team
   had effectively been relying only on the lighter one. The failures were audit
   registry drift (a moved work item, unregistered contracts) and — more seriously
   — **dangling evidence references**: criteria closed during 015 (CLV-021/022),
   016 (AGH-001..004), and 025 were given evidence ids that were never backed by
   formal `evidence/runs/*.json` records. Every other item (36 records) uses the
   formal model; this was drift, not a chosen lighter convention. ForgeLink's own
   `.local` evidence check only verified the id string appeared in the README,
   which is nearly tautological and masked the gap.

A green check that can pass while the authoritative validator fails is the exact
failure mode work item 025 set out to eliminate.

## Decision

1. **Upgrade the vendored RepoPact to 1.5.0.** Re-vendor the 1.5.0 CLI scripts and
   bump the pins (`scripts/REPOPACT_VERSION`, `requirements-repopact.txt`,
   `audits/registry.json`). 1.5.0 absorbed two former ForgeLink extensions upstream
   (the orphan-work-dir hard check and the dead `source_of_truth` warning), so only
   the **preflight** extension remains carried in `validate_repo.py` and
   `work-item.schema.json`.

2. **Restore the formal evidence model.** Recent work drifted off it; create the
   missing `evidence/runs/*.json` records so every satisfied criterion references a
   real evidence run. The formal model is ForgeLink's evidence convention; the
   lightweight README-only id was an accident, not a policy.

3. **One authoritative validator, with a thin local extension.**
   `scripts/validate_repo.py` (RepoPact) is authoritative. `.local/validate_system.py`
   now runs it first and fails if it fails, then layers only the checks RepoPact
   does not have:
   - README ↔ manifest checkbox parity (LIE-001),
   - the schema-migration ladder invariants (LIE-003, see decision 0011),
   - markdown link resolution and non-future `last_verified`.
   The tautological evidence-log check (LIE-002) is retired in favor of RepoPact's
   formal evidence requirement. The git hooks call `.local/validate_system.py`, so
   a single entry point cannot be green while RepoPact is red.

## Consequences

- `python scripts/validate_repo.py` and `python .local/validate_system.py` both
  pass on the tree, and the hooks enforce both via the single local entry point.
- Future criteria must ship a formal `evidence/runs/*.json` record to be closed —
  the README evidence-log row remains as human narrative but is no longer the
  machine-checked artifact.
- **Upstream candidates.** Three ForgeLink-local extensions are generically useful
  and are candidates to contribute back to RepoPact later: the `preflight` marker
  check, the README↔manifest **checkbox parity** check (RepoPact validates the
  manifest but never parses the README), and the schema-ladder invariant pattern.
  This is recorded here so the divergence is intentional and revisitable, not lost.
- The upstream RepoPact repo and other consuming repositories are intentionally out
  of scope for this change.
