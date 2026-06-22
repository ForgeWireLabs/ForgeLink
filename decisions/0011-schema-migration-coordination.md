---
id: 0011
title: Schema Migration Coordination Across Concurrent Work Items
status: accepted
date: 2026-06-22
supersedes: []
---

# 0011: Schema Migration Coordination Across Concurrent Work Items

## Context

Work item 015 (CLV-022) requires a convention so the concurrently-active work
items 015, 016, and 017 — plus the channel-adapter items 018–024 that depend on
015 — do not collide when they change the local SQLite schema.

ForgeLink has exactly one migration ladder. It lives in
[`Electron/backend/src/database.ts`](../Electron/backend/src/database.ts) in
`migrate()`, keyed off SQLite `PRAGMA user_version`, with `CURRENT_SCHEMA_VERSION`
as the head. Each step is an `if (version === N)` block that runs inside a single
`BEGIN IMMEDIATE` transaction, and the database copies a `*.pre-migration-vN-*`
backup before any upgrade runs.

The risk is purely organizational: two work items developed in parallel could
both add "the next migration" as `version === 11`, or could edit an
already-shipped step, corrupting upgrades for installed databases. Nothing in the
code prevents that today. This record makes ownership explicit.

## Decision

### One ladder, append-only

1. `migrate()` in `database.ts` is the **only** place schema migrations are
   defined. No work item introduces a second migration mechanism.
2. Migration steps are **append-only**. Once a step has shipped in a release
   (see `CHANGELOG.md` / `VERSION`), its SQL is frozen. Corrections ship as a new
   higher-numbered step, never as an edit to a shipped step.
3. Each new step bumps `CURRENT_SCHEMA_VERSION` by exactly one and sets
   `PRAGMA user_version` to the same number. Version numbers are never skipped or
   reused.

### Sequential ownership by allocation table

The ladder is physically contiguous: `migrate()` advances one integer at a time
through `if (version === N)` blocks, so `user_version` numbers are allocated as a
single shared, contiguous sequence — not as per-item numeric ranges. Reserving
gapped bands (for example "016 starts at v30") would fight the contiguous ladder
and waste numbers, so ownership is tracked **per version in the allocation table
below** instead. Whichever item lands the next migration claims the next free
integer and records its ownership here. The migration order is the numeric order
of the ladder.

This still gives each item unambiguous ownership of the versions it introduces;
"sequential" means the numbers are claimed in landing order and never reused, and
the table is the single place that says who owns what.

| Version | Owner | Change | Status |
| --- | --- | --- | --- |
| v1 | Foundations | base messaging schema (contacts, threads, messages) | shipped |
| v2 | Foundations | `app_metadata` | shipped |
| v3 | Foundations | message delivery reliability (`provider_sid`, `attempt_count`, `last_error`), `drafts` | shipped |
| v4 | Foundations (011/MCP) | `agent_messages` | shipped |
| v5 | Foundations (011/MCP) | `mcp_tokens` | shipped |
| v6 | Foundations (011/MCP) | `agent_channels`, `agent_channel_events` | shipped |
| v7 | Foundations (008) | `signal_subscriptions`, `signal_items` | shipped |
| v8 | 015 CLV-009/010/011 | contact metadata columns, `contact_points`, `contact_policy` | shipped |
| v9 | 015 CLV-011 | `contact_policy.quiet_hours_override` | shipped |
| v10 | 015 CLV-013 | `calls` table | shipped |
| v11 | 016 AGH-001 | `human_cards` (resolvable local operator authority; seeds `operator:primary`) | shipped |

Future allocations are appended to this table as they land. 015's dependent
channel-adapter items (018–024) and the governance/cockpit items (016/017) all
draw from the same sequence; the owner column, not the number, identifies the
item.

### Claiming a version

Before writing a migration step, the implementing item:

1. takes the next free integer (`CURRENT_SCHEMA_VERSION + 1`);
2. records it as a new row in the allocation table above and in its own
   work-item README evidence log;
3. appends the `if (version === N)` block at the end of `migrate()` and bumps
   `CURRENT_SCHEMA_VERSION` to match;
4. adds a test that upgrades a database from a previously shipped schema to
   `CURRENT_SCHEMA_VERSION` (see below).

Two items must not both claim the same integer; if two land concurrently, the
second to merge rebases onto the next free number. The allocation table is the
coordination point that makes that collision visible.

### Every migration is tested from a previously shipped schema

A migration is not "done" until a test seeds a database at a previously shipped
`user_version` (with representative data) and asserts that opening it through
`PhoneDatabase`:

- reaches `CURRENT_SCHEMA_VERSION`;
- writes a pre-migration backup;
- preserves existing rows with no data loss.

These tests live in
[`Electron/backend/src/database.test.ts`](../Electron/backend/src/database.test.ts).
Coverage today exercises the v1 legacy Twilio-Phone schema and the v7 pre-015
baseline, both upgrading to the current head. New steps extend this set.

## Consequences

- Parallel work on 015/016/017 surfaces collisions at one coordination point —
  the allocation table — rather than silently producing two `version === 11`
  steps. Concurrent landings rebase onto the next free number.
- Upgrade safety for installed databases is protected by the append-only rule and
  the from-previous-shipped-schema tests.
- The convention is lightweight: no new tooling, just the allocation table and a
  test obligation. It can be tightened later (for example, a validator check that
  `CURRENT_SCHEMA_VERSION` only ever increases and matches the highest `version === N`
  block) if the manual rule proves insufficient.
- The version number alone does not reveal the owning item; the allocation table
  is the source of truth for ownership.
