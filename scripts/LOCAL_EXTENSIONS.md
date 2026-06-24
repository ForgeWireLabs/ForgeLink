# ForgeLink local extensions to vendored RepoPact

ForgeLink **vendors** RepoPact under `scripts/` and `schemas/` (see decision
[0002](../decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md)). It does
not `pip install repopact`, so the governance layer travels with the repo. There is
**no plugin/extension point**: ForgeLink's local additions are patches applied
directly inside the vendored files. A RepoPact re-vendor copies upstream over those
files and therefore **clobbers every carried patch** unless it is re-applied.

This file is the single authoritative registry of those patches. It exists so that:

- a **re-vendor** (the next `repopact` upgrade) is a three-way merge — take
  upstream, then re-apply every "carried" row below;
- an **agent or human modifying the repo** does not silently delete a carried patch
  (if you touch a vendored file, check this table first);
- a **fresh adoption** of RepoPact in another repo knows which behaviors are local
  and which are upstream candidates to request from RepoPact directly.

Pinned RepoPact version: see [`REPOPACT_VERSION`](REPOPACT_VERSION) (currently 1.6.0).

## Carried local patches (must be re-applied on every re-vendor)

| Patch | Where | Why | Upstream candidate |
| --- | --- | --- | --- |
| **`preflight` marker** | `scripts/validate_repo.py` (`PREFLIGHT_REQUIRED_FROM_ID`, `validate_work_preflight`) + `schemas/work-item.schema.json` (`preflight` property) | Work items `010+` must declare they were created before implementation started (decision [0002](../decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md), work item 010). | **Yes** |
| **`deferred` decision status** | `scripts/validate_repo.py` + `scripts/track_import.py` (`DECISION_STATUSES`) + `schemas/record-frontmatter.schema.json` (decision `status` enum) | RepoPact already treats `deferred` as a first-class **work-item** lifecycle state (emoji, keyword aliases incl. "parking") but omits it from the **decision** status vocabulary. A decision *to defer* is a real, distinct disposition (not `proposed`/`accepted`/`rejected`/`superseded`/`deprecated`). Decision [0014](../decisions/0014-deferred-decision-status.md). | **Yes (strong)** |
| **Dashboard version decoupling** | `scripts/generate_dashboard.py` (`_spec_version` prefers `scripts/REPOPACT_VERSION` over root `VERSION`) | ForgeLink uses root `VERSION` for its **product** version, not the RepoPact spec version (decision [0002](../decisions/0002-vendored-repopact-1-4-0-and-local-extensions.md)). | Maybe (only affects adopters who reuse `VERSION`) |

When you add a carried patch, mark it in-code with a comment of the form
`# ForgeLink local extension: <name> (decision NNNN; see scripts/LOCAL_EXTENSIONS.md)`
and add a row above. JSON schemas use a sibling `"$comment"` field for the same.

## Local-only checks (not at risk on re-vendor)

These live in `.local/validate_system.py`, a ForgeLink-owned wrapper that runs
`scripts/validate_repo.py` first and then layers extra checks. They are **not**
vendored files, so a re-vendor does not touch them.

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

## Upstream backlog (to send to ForgeWireLabs/repopact)

Forwarding these upstream is the durable fix: once RepoPact carries them, no
adopter needs a local patch and no re-vendor can clobber them. Open issues/PRs at
[ForgeWireLabs/repopact](https://github.com/ForgeWireLabs/repopact) for:

1. **`deferred` decision status** — add `deferred` to the decision `status` enum in
   `validate_repo.py`, `track_import.py`, and `record-frontmatter.schema.json`.
   Rationale: parity with the existing `deferred` **work-item** lifecycle state; a
   deferral is a recordable decision distinct from proposed/accepted/rejected. (Also
   worth adding `rejected`, which the vocabulary likewise lacks.)
2. **`preflight` marker** — the created-before-work-started guard for work items
   `010+` (already noted as an upstream candidate in decisions 0002 and 0012).
3. **Schema-migration ladder invariant** — the append-only, allocation-table-backed
   migration-ladder check pattern (noted in decision 0012).

When an item here ships upstream, move its row to **Graduated upstream** above and
drop the carried patch on the next re-vendor.
