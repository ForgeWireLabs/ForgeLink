# 010 - Work Item Preflight Guardrails

> **Status**: Completed 2026-06-16.
> **Owners**: Planning Agent, Testing Agent, Governance Owner.
> **Depends on**: Work items `008` and `009`.

## Intent

Prevent implementation work from starting before the corresponding RepoPact work
item exists in `work/active` or `work/deferred`.

## In Scope

- Document the preflight rule in the work ledger.
- Add validation that makes retroactive work item creation visible.
- Record the 008/009 process miss and the guardrail added here.

## Out Of Scope

- Rewriting historical commits.
- Reopening completed product work.

## Acceptance Criteria

- AC-1: The work ledger states that numbered work must be created before
  implementation starts.
- AC-2: Repository validation checks a machine-readable preflight marker on new
  work items.
- AC-3: Existing completed work remains valid through explicit legacy handling,
  while new work items must carry the preflight marker.
- AC-4: Closeout evidence documents the original miss for 008/009 and the new
  protection.

## Closeout Evidence

Completed with:

- Work ledger preflight rule requiring new numbered work to be created before
  implementation starts.
- Optional `preflight` schema shape for work items.
- Validator enforcement for work items `010` and later.
- Targeted negative validator check proving a `010` item without preflight data
  is rejected.
- Evidence in `evidence/runs/20260616-work-item-preflight-guardrails.json`.

## Process Note

Work items `008` and `009` were completed after retroactive ledger movement
instead of being added before implementation began. That was wrong for
RepoPact-style tracking. `010` is the corrective item and was created in
`work/active` before changing the ledger, schema, or validator.

## Verification

- `python scripts/validate_repo.py --root .`
- `python .local/validate_system.py`
- Python inline negative check for `validate_work_preflight()`
