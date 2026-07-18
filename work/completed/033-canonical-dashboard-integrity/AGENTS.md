# Canonical Dashboard Integrity Agent

## Scope

- Own the RepoPact pin, ForgeLink validator integration, dashboard regeneration,
  deterministic failure proof, evidence, and work-item closeout for item 033.

## Required checks

- Demonstrate failure against deliberately stale `audits/reports/dashboard.md`.
- Run `python -m repopact_cli dashboard --root .` and prove validation recovers.
- Run `python .local/validate_system.py` and the focused upstream RepoPact tests.

## Constraints

- Do not weaken RepoPact validation or bypass the git hooks.
- Do not hand-edit the generated dashboard.
- Keep the upstream dependency pinned to an immutable commit.
