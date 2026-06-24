---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-24
source_of_truth: README.md; work-item.json
---

# Work Item 029: Consume RepoPact from PyPI (drop vendoring)

## Goal

Stop vendoring the RepoPact validator and consume it from PyPI
(`repopact==1.9.0`), now that the last carried patch — the `preflight` marker — is
an upstream opt-in (RepoPact 1.9.0, decision 0018). Rationale and trade-offs in
decision [0015](../../../decisions/0015-consume-repopact-from-pypi.md).

## Background

ForgeLink vendored RepoPact (decision 0002) chiefly to carry the preflight code
patch. With preflight generalized upstream and `deferred`/`rejected` already native
(1.8.0), ForgeLink has no local validator patches left, so vendoring is pure
duplication. SkillForge already moved to pip (its decision 0008); this brings
ForgeLink to the same model — the difference being ForgeLink keeps its preflight
guard, now expressed as config rather than code.

## Scope

- `requirements-repopact.txt` → `repopact==1.9.0` (was vendored + jsonschema).
- Removed vendored RepoPact modules from `scripts/` (validator + its import chain +
  CLI/generators). ForgeLink's own `scripts/` content (install/, smoke/,
  REPOPACT_VERSION, LOCAL_EXTENSIONS.md) stays.
- `governance/owners.json` → `preflight: {enabled, required_from_id: 10}`.
- `.local/validate_system.py` → invokes `python -m repopact_cli validate`.
- `schemas/` unchanged (already 1.9.0: preflight property, deferred/rejected).
- `scripts/LOCAL_EXTENSIONS.md` → records the pip model; zero carried patches.

## Non-goals

- No change to application code or the schema-migration ladder.
- `schemas/` stay in-repo by design (RepoPact validates the repo's own contracts).

## Closeout

| Criterion | Evidence |
| --- | --- |
| RPP-001 pip pin + vendored modules removed | [20260624-029-repopact-pypi-pin](../../../evidence/runs/20260624-029-repopact-pypi-pin.json) |
| RPP-002 preflight via config, parity verified | [20260624-029-repopact-pypi-pin](../../../evidence/runs/20260624-029-repopact-pypi-pin.json) |
| RPP-003 validators + Electron suite pass | [20260624-029-repopact-pypi-pin](../../../evidence/runs/20260624-029-repopact-pypi-pin.json) |

All acceptance criteria satisfied with evidence; directory moved to `work/completed/`.
