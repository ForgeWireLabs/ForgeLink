# Ledger Integrity Enforcement Agent

## Scope

- Own the local governance tooling that keeps the work ledger trustworthy:
  `.local/validate_system.py`, the `.githooks/` gate, and the closeout
  definition-of-done in `work/README.md`.
- The goal is simple: when the audit prints "passed", the ledger is actually
  internally consistent. A green check must not be able to hide README/manifest
  drift.

## What this item does not own

- It does not change product/runtime behavior under `Electron/`.
- It does not invent new ledger concepts; it enforces the conventions already
  written in `work/README.md` and the decisions directory.

## Required checks

- `python .local/validate_system.py` must pass after every change here, and must
  pass against the current tree (fix any drift the new checks surface).
- Do not weaken existing checks to make a failing tree pass; fix the tree.

## Security rules

- Hooks run local commands only; no network calls, no credential access.

## Definition of done

A criterion is done only when implementation, the audit passing against the real
tree, documentation, evidence, and remaining-risk notes are recorded.
