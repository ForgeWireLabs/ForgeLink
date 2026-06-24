# ForgeLink Agent Contract

The repository is the durable coordination surface for ForgeLink. State that matters —
authority, intent, decisions, evidence, and history — lives in versioned files, not in
conversation (`governance/invariants.json`, binding; weakening one requires operator
approval). Read every `AGENTS.md` from the root down to the file you touch.

## Scopes and ownership

Ownership and writable scopes are declared in
[`governance/owners.json`](governance/owners.json). Work is captured as records under
`work/`, proven by `evidence/runs/`, and reconciled through `audits/`. Nested
contracts (e.g. under `work/`) refine this root contract but cannot weaken it.

## Governed with RepoPact

ForgeLink is governed with [RepoPact](https://github.com/ForgeWireLabs/repopact)
(schemas and tooling vendored under `schemas/` and `scripts/`). Validate with
`python scripts/validate_repo.py` (or `repopact validate`). Derived artifacts
(`audits/reports/dashboard.md`) are generated, never hand-edited.

The vendored `scripts/` and `schemas/` carry ForgeLink-local patches on top of
upstream RepoPact. Before editing or re-vendoring any vendored file, read
[`scripts/LOCAL_EXTENSIONS.md`](scripts/LOCAL_EXTENSIONS.md) — it is the
authoritative list of carried patches (which a re-vendor will clobber unless
re-applied) and the upstream backlog. Do not silently drop a carried patch.
