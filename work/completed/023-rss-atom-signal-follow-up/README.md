---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-20
source_of_truth: work/completed/023-rss-atom-signal-follow-up/README.md; work/completed/023-rss-atom-signal-follow-up/work-item.json
---

# Work Item 023: RSS Atom Signal Follow-Up

## Goal

Review and harden RSS/Atom as a trusted-signal lane after CLV-018, without duplicating completed work item 008 or turning feeds into person-to-person channels.

## Scope

- Gap review against completed item 008.
- Trusted-signal boundary documentation.
- Optional authenticated-feed planning.
- Parser/fetch hardening where gaps remain.
- Source health, retention, mute, archive, and diagnostics behavior.

## Non-Goals

- Do not make RSS/Atom an approval channel.
- Do not treat feed content as trusted commands.
- Do not create a second message inbox for feeds.
- Do not store feed credentials outside secure settings if authenticated feeds are later added.

## Evidence Expectations

Evidence must include a gap review, deterministic fixtures for any parser/fetch changes, UI tests if surface changes, diagnostics redaction checks, and updated docs.

## Acceptance criteria

- [x] **RSSF-001** Gap review vs 008 / CLV-018 — `_audit/gap-review.md`
- [x] **RSSF-002** Remain trusted-signal lane only — `docs/trusted-signals.md`, UI copy
- [x] **RSSF-003** Authenticated-feed plan only (secure storage required) — `docs/trusted-signals.md`
- [x] **RSSF-004** Fetch/parse hardening + fixtures — `signals.ts` / `signals.test.ts`
- [x] **RSSF-005** No approval / urgent / quick-action authority — API + UI tests
- [x] **RSSF-006** UI health, retention, lane separation — Signals surface
- [x] **RSSF-007** Export redaction + diagnostics counts — database/server tests
- [x] **RSSF-008** Shipped vs future docs — `docs/trusted-signals.md`

## Closeout — 2026-07-20

All eight criteria satisfied; evidence
`20260720-rss-atom-signal-follow-up`,
`20260720-rss-atom-signal-follow-up-hardening`, and
`20260720-rss-atom-signal-follow-up-hardening-r2`. Item moved to `work/completed/`.

### Remaining risks

- Manual refresh only (no automatic scheduler).
- Operator-entered LAN/private feed URLs remain allowed when DNS resolves to
  non-global addresses; public→private redirect pivots and metadata targets
  (including direct initial URLs) are blocked; DNS answers are pinned for the
  connection.
- Authenticated feeds deferred until secure-settings credentials exist;
  credential-bearing subscription URLs (including fragments and expanded secret
  parameter names) are rejected and legacy rows scrubbed/migrated.
- XML is validated with a bounded parser (no DTD/entities); exotic but
  well-formed feeds may still fail field extraction.

### Rollback

Revert the 023 commit set; signal tables and 008 behavior remain intact. Export/diagnostics redaction and health UI are additive.
