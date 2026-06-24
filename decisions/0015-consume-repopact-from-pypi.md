---
id: 0015
title: Consume RepoPact From PyPI (drop vendoring) now that preflight is upstream
status: accepted
date: 2026-06-24
supersedes: []
---

# 0015: Consume RepoPact From PyPI (drop vendoring)

## Context

ForgeLink vendored RepoPact (`scripts/` + `schemas/`) per decision
[0002](0002-vendored-repopact-1-4-0-and-local-extensions.md), whose rationale was
that governance should travel with the repo and run on a clean machine. The one
thing that genuinely justified continued vendoring was a **carried code patch**: the
`preflight` marker check lived inside the vendored `validate_repo.py`
(`PREFLIGHT_REQUIRED_FROM_ID`, `validate_work_preflight`), so every re-vendor had to
re-apply it. Pip-installing would have silently dropped that guard.

That blocker is now gone. The preflight guard was generalized and shipped upstream as
an **opt-in, config-driven** feature in RepoPact 1.9.0 (RepoPact decision 0018):
`governance/owners.json` `preflight.enabled` + `required_from_id` (and/or
`required_from_date`). With preflight expressible as config and `deferred`/`rejected`
already native (1.8.0), ForgeLink carries **no local validator patches** — vendoring
became pure duplication with recurring re-vendor cost.

A property of RepoPact makes the switch safe: the validator reads **this repo's**
`schemas/*.json` (`root/schemas/`), so schemas — the part that is genuinely
ForgeLink's contract — stay in-repo regardless of how the tooling is delivered.

## Decision

Consume RepoPact as a **pinned PyPI dependency**.

- `requirements-repopact.txt` pins `repopact==1.9.0`.
- Remove the vendored RepoPact modules from `scripts/` (validate_repo, repo_model,
  frontmatter, track_import, plan_import, takeover, doctor, generate_*, init_repo,
  adopt_repo, new, check_frozen_surface, repopact_cli).
- `.local/validate_system.py` invokes `python -m repopact_cli validate` (then layers
  the ForgeLink-only LIE-003 schema-ladder and link/`last_verified` checks). The git
  hooks call this wrapper, unchanged.
- Enable preflight via `governance/owners.json`:
  `"preflight": {"enabled": true, "required_from_id": 10}` — identical behavior to
  the old hardcoded threshold, verified against the existing work-item markers.
- `schemas/` stay in-repo (already at 1.9.0: `preflight` property, `deferred`/
  `rejected` statuses).

## Alternatives considered

- **Stay vendored.** Rejected: with zero carried patches it is pure duplication and
  perpetual re-vendor cost.
- **Re-vendor 1.9.0 clean (no patch), stay self-contained.** Viable and preserves
  decision 0002's offline property, but keeps re-vendor churn. Chosen against in
  favor of the pin; can be revisited if the clean-machine/offline property is needed.
- **Pin unpinned / range.** Rejected: a floating version could validate a clean
  checkout against a newer ruleset. The exact pin keeps validation reproducible.

## Consequences

- Upgrades are a pin bump (`repopact==X`), no file copying, no three-way merge.
- **A fresh clone or CI must `pip install -r requirements-repopact.txt`** before
  validation works; the git hooks (which call `.local/validate_system.py`) now depend
  on the package being installed. This is the deliberate trade for ending vendor
  maintenance, accepted because the schemas (the real contract) still travel in-repo.
- ForgeLink has no carried code patches; `scripts/LOCAL_EXTENSIONS.md` records the
  history and is empty going forward.
- This revisits the consumption-model choice in decision 0002 (orphan detection and
  other 0002 items already graduated upstream); 0002 remains as historical record.
