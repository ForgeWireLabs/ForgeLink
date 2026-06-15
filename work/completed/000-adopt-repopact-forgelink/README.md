# 000 — Adopt RepoPact For ForgeLink

> **Status**: Complete. Evidence `20260615-repopact-adoption`.
> **Owners**: governance-owner lead, planning-agent and testing-agent supporting.
> **Depends on**: none.

## Intent

Integrate RepoPact into ForgeLink as a durable governance and work layer without
erasing the project's existing local instructions, documentation, release
history, or production-readiness todo.

## Decisions

Decision `0001` records the integration model: RepoPact is additive. The existing
`todos/` tree remains historical planning context, and new durable work starts
in `work/`.

## Scope

Adds RepoPact-compatible schemas, validator scripts, governance records,
decision records, evidence directories, and the initial work ledger.

## Closeout

The adoption is closed when `python scripts/validate_repo.py --root .` passes
and the evidence run records the validation.
