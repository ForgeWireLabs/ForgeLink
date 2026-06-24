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

ForgeLink is governed with [RepoPact](https://github.com/ForgeWireLabs/repopact),
consumed from PyPI (`repopact==1.9.0`, pinned in `requirements-repopact.txt`; decision
0015). Validate with `python .local/validate_system.py` (it runs `repopact validate`
plus ForgeLink's local checks). Run `pip install -r requirements-repopact.txt` on a
fresh clone first. Derived artifacts (`audits/reports/dashboard.md`) are generated,
never hand-edited.

`schemas/` stay in-repo — RepoPact validates against this repository's own contracts.
There are no vendored validator patches; the preflight guard is an upstream opt-in
enabled via `governance/owners.json` (RepoPact 1.9.0). See
[`scripts/LOCAL_EXTENSIONS.md`](scripts/LOCAL_EXTENSIONS.md) for the history and the
current model.
