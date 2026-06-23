---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-22
source_of_truth: work/completed/026-repopact-1-5-0-vendor-upgrade/README.md; work/completed/026-repopact-1-5-0-vendor-upgrade/work-item.json
---

# Work Item 026: RepoPact 1.5.0 Vendor Upgrade and Validator Unification

> Lifecycle state lives in [`work-item.json`](work-item.json); this README is the
> intent, scope, and closeout narrative.

## Goal

Bring ForgeLink's vendored RepoPact from 1.4.0 to 1.5.0, fix the drift that had
quietly made the authoritative validator fail, and end the two-validator split so
a green check is trustworthy again.

## Background

ForgeLink vendors RepoPact fully (`scripts/` + `schemas/`), pinned at 1.4.0
(`audits/registry.json` even said 1.2.0). Investigation found:

- `validate_repo.py` and `work-item.schema.json` are already 1.5.0-equivalent plus
  ForgeLink's local **preflight** extension; the genuinely behind files are the CLI
  tooling scripts (`init_repo`, `new`, `takeover`, `generate_spec`,
  `generate_dashboard`, `doctor`, `repopact_cli`, `repo_model`).
- The vendored `validate_repo.py` was **already failing 14 ways** while the
  lighter `.local/validate_system.py` passed. Three failures were audit-registry
  drift; eleven were dangling evidence references — criteria closed (during 015
  CLV-021/022, all of 016 AGH-001..004, and 025) with evidence ids that were never
  backed by formal `evidence/runs/*.json` records. Every prior item (36 records)
  uses the formal model; this was drift, not a deliberate lighter convention.
- ForgeLink's own `.local` evidence check (LIE-002) only verified the id string
  appears in the README, which is nearly tautological and masked the drift.

## Approach

1. **Re-vendor 1.5.0 CLI scripts** (RPU-001) with no FL-local content lost; keep
   the preflight extension and the `install`/`smoke` helpers; bump version pins.
2. **Reconcile evidence** (RPU-002): create the missing `evidence/runs/*.json`
   records so every satisfied criterion references a real record.
3. **Fix registry drift** (RPU-003): 015 scope path, register 015/025 contracts.
4. **Unify validators** (RPU-004): `.local/validate_system.py` runs
   `validate_repo.py` as the authoritative governance pass, then layers the
   ForgeLink-only checks RepoPact lacks (checkbox parity, schema-ladder, link/date).
   Retire the tautological LIE-002.
5. **Record the decision** (RPU-005) and note FL extensions that could go upstream.

## Non-goals

- No changes to `Electron/` runtime/product behavior.
- No changes to the upstream RepoPact repo or other repositories.

## Security and privacy constraints

- No credentials or runtime secrets in tooling, evidence, or fixtures.

## Definition of done

- Both `python scripts/validate_repo.py` and `python .local/validate_system.py`
  pass on the real tree.
- Every closed criterion has a formal evidence record, docs, and rollback notes.

## Acceptance criteria

- [x] **RPU-001 Re-vendor 1.5.0 CLI scripts + bump version pins**, preserving the
  preflight extension and FL-local helpers.
- [x] **RPU-002 Reconcile evidence** by creating the missing formal evidence/runs
  records.
- [x] **RPU-003 Fix audits/registry.json drift** (015 path, 015/025 contracts,
  version note).
- [x] **RPU-004 Unify validators** so RepoPact is authoritative and `.local` is a
  thin extension; retire LIE-002.
- [x] **RPU-005 Record the decision** and upstream-candidate notes.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-22 | planning | Vendoring/version review traced the "behind" state to drifted evidence records plus a two-validator split | Created item 026 before implementation starts. |
| 2026-06-22 | RPU-001..005 complete | Evidence `20260622-026-repopact-1-5-0-vendor-upgrade`: re-vendored RepoPact 1.5.0 CLI scripts (preserving the preflight extension + FL `install`/`smoke` helpers) and bumped pins (`scripts/REPOPACT_VERSION`, `requirements-repopact.txt`, `audits/registry.json`); created the 7 missing `evidence/runs/*.json` records so every satisfied criterion resolves; fixed registry drift (015 path to completed, registered 015/025/026 contracts); unified the validators so `scripts/validate_repo.py` is authoritative and `.local/validate_system.py` layers parity (LIE-001) + schema-ladder (LIE-003) + link/date, retiring the tautological LIE-002; decision `0012` records it. Both `python scripts/validate_repo.py` and `python .local/validate_system.py` pass. | All five criteria satisfied. |

## Closeout

All five criteria are satisfied and both validators pass on the tree.

### What shipped

- **1.5.0 vendor upgrade**: 1.5.0 CLI scripts re-vendored; pins bumped from 1.4.0
  (and the 1.2.0 registry note) to 1.5.0. 1.5.0 absorbed two former ForgeLink
  extensions upstream (orphan-work-dir check, dead `source_of_truth` warning), so
  only the **preflight** extension remains carried locally.
- **Evidence reconciliation**: 7 dangling evidence references (CLV-021/022,
  AGH-001..004, 025) now have real `evidence/runs/*.json` records, matching the 36
  that were already there.
- **Registry fixes**: 015 scope moved to `work/completed`, and the 015/025/026
  contracts registered.
- **Validator unification**: `scripts/validate_repo.py` (RepoPact) is authoritative;
  `.local/validate_system.py` runs it then layers checkbox parity (LIE-001),
  schema-ladder (LIE-003), and link/`last_verified` checks. LIE-002 retired.
- **Decision 0012** records the architecture and the upstream-candidate extensions.

### Limitations / remaining risk

- The upstream RepoPact repo and other consumers were intentionally untouched; the
  three FL-local extensions (preflight, checkbox parity, schema-ladder) remain
  candidates to contribute upstream later (noted in 0012).
- Closing a criterion now requires a formal `evidence/runs` record; the README
  evidence-log row is human narrative, no longer the machine-checked artifact.
- The unified `.local` validator shells out to `scripts/validate_repo.py`; it needs
  `jsonschema` available (pinned in `requirements-repopact.txt`).

### Rollback

Restore the prior `scripts/*` from git, revert `.local/validate_system.py`, and
reset the version pins. No runtime/product code changed.
