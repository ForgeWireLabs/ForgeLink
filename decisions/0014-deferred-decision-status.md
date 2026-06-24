---
id: 0014
title: Add a "deferred" Status to the Decision Vocabulary
status: accepted
date: 2026-06-23
supersedes: []
---

# 0014: Add a "deferred" Status to the Decision Vocabulary

> Numbering note: ForgeLink's decision IDs are independent of RepoPact's own
> internal decision numbering. Vendored code and work item 027 reference an
> upstream "RepoPact decision 0014" (README↔manifest checkbox parity); that is a
> different namespace from this ForgeLink decision 0014.

## Context

A decision record's `status` frontmatter was constrained to
`proposed | accepted | superseded | deprecated` (in `scripts/validate_repo.py`,
`scripts/track_import.py`, and `schemas/record-frontmatter.schema.json`). None of
those expresses a common, real disposition: *we considered this, it is coherent, we
are deliberately not pursuing it now, and here are the conditions under which we
would revisit it.*

- `proposed` means "on the table, awaiting a decision" — but a deferral **is** a
  decision; the idea is no longer awaiting one.
- `deprecated` implies prior adoption being phased out — a never-adopted idea cannot
  be deprecated.
- `superseded` requires a replacement record.
- A deferral is also distinct from a rejection: `rejected` closes the door,
  `deferred` leaves it open with explicit reactivation criteria.

This surfaced with decision
[0013](0013-ghost-fabric-channel.md) (ghost fabric channel), which is exactly this
disposition. Lacking a `deferred` status, it had to be filed as `proposed` with a
prose "parked" note apologizing for the missing vocabulary — a tell that the
vocabulary was incomplete.

The asymmetry is the core argument. RepoPact already treats `deferred` as a
**first-class work-item lifecycle state** — the work lifecycle is
`active | blocked | deferred | completed`, with an `⏸️ Deferred` dashboard emoji and
keyword aliases (`later`, `future`, `someday`, `deferred`, `icebox`, `parking`,
`wishlist`). Decisions and work items are the two durable record types in this repo;
canonizing `deferred` for one and not the other is an arbitrary gap, and a deferred
decision is semantically identical to a `work/deferred/` item.

## Decision

1. **Add `deferred` to the decision `status` vocabulary** in the three vendored
   locations: `DECISION_STATUSES` in `scripts/validate_repo.py` and
   `scripts/track_import.py`, and the decision `status` enum in
   `schemas/record-frontmatter.schema.json`. Definition: *a decision to not pursue
   the proposal now, kept for its reasoning, with stated reactivation criteria.*
   `proposed` remains "awaiting a decision"; `deferred` means a decision to wait has
   been made.

2. **Record it as a carried local extension.** Like the `preflight` marker, this is
   a patch inside vendored RepoPact files that a re-vendor will clobber. It is
   marked in-code (`# ForgeLink local extension ...`) and registered in
   [`scripts/LOCAL_EXTENSIONS.md`](../scripts/LOCAL_EXTENSIONS.md), which is now the
   single authoritative list of carried patches and upstream candidates. Re-vendor
   is a three-way merge: take upstream, re-apply every carried row.

3. **Forward it upstream.** `deferred` (and the likewise-missing `rejected`) are
   logged in the upstream backlog in `LOCAL_EXTENSIONS.md` to contribute to
   [ForgeWireLabs/repopact](https://github.com/ForgeWireLabs/repopact). Once
   upstream carries it, the local patch is dropped on the next re-vendor.

4. **Apply it:** decision 0013 moves from `proposed` to `deferred`.

## Alternatives considered

- **Keep `status: proposed` plus a prose "parked" note.** Rejected: it overloads
  `proposed` to mean both "awaiting decision" and "decided against for now," and
  requires every reader to parse prose to learn the real disposition.
- **Use `deprecated`.** Rejected: `deprecated` implies the decision was once adopted;
  0013 never was.
- **Add the check only in `.local/validate_system.py`.** Not possible: the status
  enum is a rejection in the authoritative `validate_repo.py`, which `.local` runs
  first and cannot loosen. The enum must change in the vendored validator.
- **Fork RepoPact instead of patching the vendored copy.** Rejected: heavier than
  the established carried-patch convention; the right durable fix is upstreaming.

## Consequences

- Decision records can now express a deferral as a first-class status, matching the
  work-item lifecycle. Decision 0013 uses it.
- One more carried patch exists. It is registered in `LOCAL_EXTENSIONS.md`, which
  consolidates what was previously scattered across decisions 0002 and 0012, so a
  re-vendor or an agent editing vendored files has a single place to consult.
- While the local carry differs from vendored 1.6.0, `repopact doctor` may report the
  schema as `schema-differs`; it must not auto-overwrite the local additions (same
  posture as `preflight`, decision 0002).
- **Upstreamed.** `deferred` (with `rejected`) shipped upstream in RepoPact 1.8.0
  (RepoPact decision 0017), so this is no longer a divergence to defend indefinitely:
  the carry is interim and is dropped when ForgeLink re-vendors 1.8.0. Until that
  re-vendor, the carried patch keeps `deferred` working on the vendored 1.6.0 tree.
