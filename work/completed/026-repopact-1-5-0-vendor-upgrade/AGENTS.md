# RepoPact 1.5.0 Vendor Upgrade Agent

## Scope

- Own the vendored RepoPact tooling under `scripts/` and `schemas/`, its version
  pins, the audit registry, and the relationship between the vendored
  `validate_repo.py` and the ForgeLink-local `.local/validate_system.py`.

## What this item does not own

- It does not change product/runtime behavior under `Electron/`.
- It does not modify the upstream RepoPact repo or other repositories.

## Required checks

- Both validators must pass against the real tree before closing any criterion:
  `python scripts/validate_repo.py` and `python .local/validate_system.py`.
- Preserve ForgeLink-local extensions: the preflight check in `validate_repo.py`
  and `schemas/work-item.schema.json`, and the `scripts/install`/`scripts/smoke`
  helpers.

## Security rules

- No credentials, contacts, message bodies, or runtime secrets in evidence,
  fixtures, or tooling.

## Definition of done

A criterion is done only when implementation, both validators passing,
documentation, evidence (formal evidence/runs record), and rollback notes are
recorded.
