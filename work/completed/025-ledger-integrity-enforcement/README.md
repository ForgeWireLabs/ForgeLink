---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-22
source_of_truth: work/completed/025-ledger-integrity-enforcement/README.md; work/completed/025-ledger-integrity-enforcement/work-item.json
---

# Work Item 025: Ledger Integrity Enforcement

> Lifecycle state lives in [`work-item.json`](work-item.json); this README is the
> intent, scope, and closeout narrative.

## Goal

Make the work ledger self-enforcing so repository integrity does not depend on a
human (or an agent) remembering to catch drift. The trigger was a real failure:
a README was hand-reverted so its acceptance-criteria checkboxes and evidence log
contradicted `work-item.json`, yet `validate_system.py` still printed
"Local system audit passed." A green check that can hide drift trains people to
stop trusting it.

## Background

`validate_system.py` already validates `work-item.json` (status vs directory,
criterion states, satisfied-needs-evidence, preflight, link/date). It never
parsed the README's checkboxes or evidence log, so README↔manifest drift was
invisible. Separately, the audit only ran when invoked by hand, so even a perfect
audit could be bypassed by simply not running it.

## Approach — three tiers

### Tier 1 — make "passed" trustworthy (structural audit checks)

- **LIE-001 README↔manifest checkbox parity.** Every manifest criterion must have
  a README checkbox line, and `satisfied → [x]`, `pending → [ ]`. (Waived is left
  flexible.) This is the check that would have caught the original drift.
- **LIE-002 evidence cross-reference.** Every satisfied criterion's evidence id
  must appear in the README evidence log, so "satisfied" is always traceable.
- **LIE-003 schema-ladder invariants.** Enforce decision 0011:
  `CURRENT_SCHEMA_VERSION` equals the highest contiguous migration step, the
  `version === N` guards are contiguous from 0, and every shipped version has an
  allocation-table row in decision 0011.

### Tier 2 — make the audit a gate (LIE-004)

Versioned `.githooks/` wired through `core.hooksPath`: **pre-commit** runs the
audit; **pre-push** runs the audit plus the test suite. Drift cannot reach the
branch by relying on memory.

### Tier 3 — the judgment-laden steps (LIE-005)

Some steps cannot be fully automated (is this CHANGELOG-worthy? is this criterion
truly done?). For those: a per-criterion **closeout definition-of-done checklist**
in `work/README.md`, plus a **soft, non-blocking** pre-commit reminder when
backend source changes without a CHANGELOG entry.

## Acceptance criteria

- [x] **LIE-001 README↔manifest checkbox parity.** The audit fails when a
  satisfied criterion is unchecked, a checked criterion is still pending, or a
  manifest criterion has no checkbox in a convention-using README.
- [x] **LIE-002 Evidence cross-reference.** The audit fails when a satisfied
  criterion's evidence id is missing from the README evidence log (where one
  exists).
- [x] **LIE-003 Schema-ladder invariants.** The audit enforces the decision 0011
  ladder: contiguous version guards, `CURRENT_SCHEMA_VERSION` matching the head,
  and allocation-table coverage.
- [x] **LIE-004 Git-hook gate.** Versioned `.githooks/` run the audit on commit
  and the audit plus tests on push, wired via `core.hooksPath`.
- [x] **LIE-005 Closeout checklist + soft CHANGELOG reminder.** A per-criterion
  definition-of-done is recorded in `work/README.md`, and the pre-commit hook
  emits a non-blocking reminder when backend source changes without a CHANGELOG
  entry.

## Non-goals

- Do not change runtime/product behavior under `Electron/`.
- Do not hard-fail on CHANGELOG currency (it is a judgment call → soft reminder).
- Do not introduce remote services; enforcement stays local.

## Security and privacy constraints

- Hooks execute local commands only — no network, no credentials, no message or
  contact data.

## Definition of done

- The new checks pass against the current tree (drift they surface is fixed, not
  suppressed).
- The audit and hooks are documented.
- Every closed criterion records evidence, limitations, and rollback notes.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-22 | planning | Ledger drift review with operator after a README hand-revert passed the audit | Created item 025 before implementation starts. |
| 2026-06-22 | LIE-001..005 complete | Evidence `20260622-025-ledger-integrity-enforcement`: extended `.local/validate_system.py` with README↔manifest checkbox parity (LIE-001), evidence cross-reference (LIE-002), and decision 0011 schema-ladder invariants (LIE-003), each gated on the relevant convention and each proven by a negative test (parity caught the real CLV-001..008 drift in completed 015; schema-ladder caught a forced version mismatch; evidence caught a bogus id); added versioned `.githooks/` (pre-commit audit + soft CHANGELOG reminder, pre-push audit + tests) wired via `core.hooksPath` with `.gitattributes` keeping hooks LF (LIE-004); recorded a per-criterion closeout checklist in `work/README.md` (LIE-005). Audit passes against the real tree. | All five criteria satisfied. |

## Closeout

All five acceptance criteria are satisfied. The work-ledger audit is now
structural and gated, so the failure that triggered this item — a hand-reverted
README passing a green audit — can no longer happen silently.

### What shipped

- `.local/validate_system.py` gained three structural checks: README↔manifest
  checkbox parity, evidence cross-reference, and schema-ladder invariants. Each is
  gated on the relevant convention so legacy/minimal READMEs are not forced to
  restructure, and each was verified with a negative test.
- The first run surfaced and fixed real drift: completed item 015 had CLV-001..008
  marked `satisfied` in the manifest but unchecked in the README.
- `.githooks/pre-commit` (audit + soft CHANGELOG reminder) and `.githooks/pre-push`
  (audit + test suite), wired via `core.hooksPath = .githooks`, with `.gitattributes`
  forcing LF so the shebang works on Windows.
- A per-criterion closeout definition-of-done in `work/README.md`.

### Limitations / remaining risk

- Parity and evidence checks are gated on convention presence: an item whose
  README uses neither checkboxes nor an evidence-log section is not yet covered.
  Active items 018-024 currently fall in this gap until they adopt the checklist
  convention as work begins on them.
- `core.hooksPath` is per-clone; new clones must run the documented one-liner.
  Hooks can be bypassed with `--no-verify`; the gate is a safety net, not a hard
  server-side block.
- The schema-ladder check is coupled to the current file layout
  (`Electron/backend/src/database.ts`, decision 0011); it skips (does not fail) if
  those move, to avoid false negatives.

### Rollback

Revert the `.local/validate_system.py` changes and `git config --unset
core.hooksPath` to return to the prior advisory-only behavior. No runtime/product
code changed.
