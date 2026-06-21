---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
source_of_truth: work/active/023-rss-atom-signal-follow-up/README.md; work/active/023-rss-atom-signal-follow-up/work-item.json
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

