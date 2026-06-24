# ForgeLink + RepoPact: local extensions (historical) and current model

> **Current model (decision [0015](../decisions/0015-consume-repopact-from-pypi.md)):**
> ForgeLink **no longer vendors** the RepoPact validator. It is consumed from PyPI
> (`repopact==1.9.0`, pinned in [`requirements-repopact.txt`](../requirements-repopact.txt))
> and invoked through `.local/validate_system.py`. **There are zero carried code
> patches** — every former local extension has graduated upstream (see the table
> below). Two things still live in-repo by design:
>
> - **`schemas/`** — RepoPact validates against this repository's own contracts
>   (`root/schemas/*.json`), so the schemas always travel in-repo.
> - **`.local/validate_system.py`** — ForgeLink-only checks layered on top of the
>   upstream validator (LIE-003 schema-ladder; markdown link / `last_verified`).
>
> The "carried patches" section below is retained as history; it is **empty going
> forward**. There is nothing to re-apply on upgrade — bump the pin instead.

ForgeLink originally **vendored** RepoPact under `scripts/` and `schemas/` (decision
[0002](../decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md)), carrying
local patches inside the vendored files. That model ended with decision 0015; the
notes below document what was carried and where it went.

Pinned RepoPact version: [`REPOPACT_VERSION`](REPOPACT_VERSION) / `requirements-repopact.txt` (currently 1.9.0).

## Carried local patches

**None.** ForgeLink consumes RepoPact from PyPI; there is no vendored validator to
patch. The last carried patch — the `preflight` marker — graduated upstream in
RepoPact 1.9.0 (see below) and is now enabled via `governance/owners.json` config,
not code.

## Local-only checks (ForgeLink-owned, layered on the upstream validator)

These live in `.local/validate_system.py`, which runs `repopact validate` (PyPI)
first and then layers extra checks. They are ForgeLink's own code, never affected by
a RepoPact upgrade.

| Check | Why | Upstream candidate |
| --- | --- | --- |
| Schema-migration ladder invariants (LIE-003) | Enforces the single append-only `database.ts` migration ladder and the decision [0011](../decisions/0011-schema-migration-coordination.md) allocation table. | **Yes** (the invariant pattern is generic) |
| Markdown link resolution + non-future `last_verified` | Catches dangling record links and post-dated verification stamps. | Maybe |

## Graduated upstream (no longer carried — do not re-add as local patches)

Recorded so they are not mistaken for missing local patches during a re-vendor:

| Former local extension | Graduated in | Reference |
| --- | --- | --- |
| Orphan-work-dir hard check (`validate_orphan_work_dirs`) | RepoPact 1.5.0 | decision [0012](../decisions/0012-repopact-1-5-0-upgrade-and-validator-unification.md) |
| Dead `source_of_truth` warning (`doctor`) | RepoPact 1.5.0 | decision [0012](../decisions/0012-repopact-1-5-0-upgrade-and-validator-unification.md) |
| README ↔ manifest checkbox parity (formerly LIE-001) | RepoPact 1.6.0 | decision [0012](../decisions/0012-repopact-1-5-0-upgrade-and-validator-unification.md), work item 027 |
| `deferred` **and** `rejected` decision statuses | RepoPact 1.8.0 (RepoPact decision 0017) | ForgeLink decision [0014](../decisions/0014-deferred-decision-status.md); re-vendored in work item 028 |
| Dashboard version decoupling (`generate_dashboard._spec_version` prefers `REPOPACT_VERSION`) | Present in upstream; vendored copy matches, no local carry | decision [0002](../decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md) |
| Opt-in `preflight` marker (config-driven, id/date threshold) | RepoPact 1.9.0 (RepoPact decision 0018) | ForgeLink decision [0015](../decisions/0015-consume-repopact-from-pypi.md); enabled via `governance/owners.json` |

The remaining ForgeLink-local LIE-003 schema-ladder invariant (in `.local/`) is the
last upstream candidate worth contributing.

## Upstream backlog (to send to ForgeWireLabs/repopact)

Forwarding these upstream is the durable fix: once RepoPact carries them, no
adopter needs a local patch and no re-vendor can clobber them. Open issues/PRs at
[ForgeWireLabs/repopact](https://github.com/ForgeWireLabs/repopact) for:

1. ~~**`deferred` decision status**~~ — **done.** Shipped upstream in RepoPact 1.8.0
   together with `rejected` (RepoPact decision 0017). The local carry is interim;
   drop it when ForgeLink re-vendors 1.8.0.
2. **`preflight` marker** — the created-before-work-started guard for work items
   `010+` (already noted as an upstream candidate in decisions 0002 and 0012).
3. **Schema-migration ladder invariant** — the append-only, allocation-table-backed
   migration-ladder check pattern (noted in decision 0012).

When an item here ships upstream, move its row to **Graduated upstream** above and
drop the carried patch on the next re-vendor.
