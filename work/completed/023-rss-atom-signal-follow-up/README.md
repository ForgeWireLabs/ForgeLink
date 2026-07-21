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
`20260720-rss-atom-signal-follow-up-hardening`,
`20260720-rss-atom-signal-follow-up-hardening-r2`,
`20260720-rss-atom-signal-follow-up-hardening-r3`, and
`20260720-rss-atom-signal-follow-up-hardening-r4`. Item moved to `work/completed/`.

### Remaining risks

- Manual refresh only (no automatic scheduler).
- Operator LAN (RFC1918/loopback/ULA) remains allowed on the initial URL when DNS
  resolves entirely there; cloud metadata/link-local and IANA special-purpose
  destinations stay forbidden for public pivots; DNS answers are pinned for the
  connection under a shared deadline.
- Authenticated feeds deferred until secure-settings credentials exist;
  credential detection covers keys and decoded values (embedded URLs, JWTs,
  assignments), including fragments.
- XML is validated with a bounded parser (no DTD/entities; boolean attributes
  rejected); exotic but well-formed feeds may still fail field extraction.
- Migration-era dedupe aliases cover known 19da/3df822e identity shapes; unknown
  opaque 64-hex GUIDs are preserved (never rewritten or deleted on collision).
  Only hashes proven equal to the 19da `legacy-external` formula are migrated.

### Rollback

Revert the 023 commit set; signal tables and 008 behavior remain intact. Export/diagnostics redaction and health UI are additive.
