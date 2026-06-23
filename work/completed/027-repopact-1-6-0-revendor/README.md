---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-22
source_of_truth: work/completed/027-repopact-1-6-0-revendor/README.md; work/completed/027-repopact-1-6-0-revendor/work-item.json
---

# Work Item 027: Re-vendor RepoPact 1.6.0 (checkbox parity upstreamed)

> Lifecycle state lives in [`work-item.json`](work-item.json); this README is the
> intent and closeout narrative.

## Goal

After contributing ForgeLink's README↔manifest checkbox-parity check upstream into
RepoPact 1.6.0 (RepoPact decision 0014), re-vendor 1.6.0 into ForgeLink and remove
the now-redundant local copy, so parity is enforced once, by the authoritative
validator.

## Background

Work item 026 unified the validators and flagged checkbox parity as an
upstream candidate (decision 0012). That candidate has now shipped in RepoPact
1.6.0. This item brings the upstreamed check back down and retires the local
duplicate.

## What shipped

- The 1.6.0 `validate_readme_checkbox_parity` check is added to the vendored
  `scripts/validate_repo.py`, on top of ForgeLink's retained **preflight**
  extension. Pins bumped to 1.6.0 (`scripts/REPOPACT_VERSION`,
  `requirements-repopact.txt`, `audits/registry.json`).
- The former local parity check (LIE-001) is removed from
  `.local/validate_system.py`; it now layers only the schema-ladder (LIE-003) and
  link/`last_verified` checks on top of the authoritative RepoPact pass.

## Non-goals

- No `Electron/` runtime changes. No other repos.

## Security and privacy constraints

- Tooling only; no credentials or runtime secrets.

## Acceptance criteria

- [x] **RVN-001 Add the 1.6.0 parity check to the vendored validator and bump
  pins**, preserving preflight.
- [x] **RVN-002 Remove the redundant local parity check** from `.local`.
- [x] **RVN-003 Both validators pass** on the tree.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-22 | planning | Followed 026's upstream-candidate note: parity shipped in RepoPact 1.6.0 (decision 0014) | Created item 027 before the re-vendor. |
| 2026-06-22 | RVN-001..003 complete | Evidence `20260622-027-repopact-1-6-0-revendor`: added `validate_readme_checkbox_parity` to vendored `scripts/validate_repo.py` (preflight preserved), bumped pins to 1.6.0, removed the local parity duplicate from `.local/validate_system.py`. Both `python scripts/validate_repo.py` and `python .local/validate_system.py` pass. | All three criteria satisfied. |

## Closeout

Checkbox parity is now enforced once, by the authoritative vendored validator;
ForgeLink's `.local` extension is correspondingly thinner (schema-ladder +
link/date only). RepoPact's preflight gap remains ForgeLink-local. Rollback:
revert `scripts/validate_repo.py`, `.local/validate_system.py`, and the pins.
