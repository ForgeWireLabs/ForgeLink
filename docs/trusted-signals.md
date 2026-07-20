---
audience: operators and maintainers
status: current
last_verified: 2026-07-20
source_of_truth: docs/trusted-signals.md; decisions/0009-channel-roadmap-and-matrix-exclusion.md; work/completed/008-rss-trusted-signals-adapter/; work/completed/023-rss-atom-signal-follow-up/README.md
---

# Trusted Signals (RSS / Atom)

ForgeLink treats RSS and Atom as a **trusted-signal reading lane**, not as a
person-to-person channel and not as an approval surface.

## Shipped behavior (008 + 023)

- Local subscriptions with title, URL, fetch interval, pause/mute, and
  per-source retention.
- Manual refresh (interval is advisory UI; automatic scheduling is intentionally
  not running).
- Bounded fetch: http(s) only, 8s timeout, at most 3 redirects, 1 MB response
  cap, content-type checks.
- Text-only parse of RSS/Atom items (HTML/script stripped); duplicate external
  IDs ignored; tracking query parameters stripped from item links.
- Separate `signal_subscriptions` / `signal_items` tables from SMS, email, and
  agent messages.
- Signals UI under Channels with source health (healthy / stale / failed /
  paused / never fetched), retention display, archive, and external Open.
- Attention default keeps signal notifications off.
- Backup covers the SQLite store; JSON export includes signal rows with
  credential-like URL query parameters and userinfo redacted.
- Support diagnostics expose **counts and health tallies only** — never feed
  URLs, titles, summaries, or item bodies.
- Mobile / linked-node policy forbids syncing `signal_content`.

## Boundary (RSSF-002)

| Surface | Signals? |
| --- | --- |
| Person-to-person messaging | No |
| Channel-adapter registry (SMS, email, push, …) | No — signals stay a dedicated lane |
| Agent approval / decision queue | No |
| Urgent interrupt ladder | No (`signal_notifications` is `all` or `off`) |
| Quick actions / approve-deny | No |

Feed items may be opened externally. They cannot become approvals, urgent
interrupts, or quick actions without a future trusted-source policy and
explicit local confirmation (not shipped).

## Authenticated feeds (plan only — RSSF-003)

Ordinary feeds need no credentials. Optional authenticated feeds remain
**future** and must satisfy:

1. Store URL tokens or HTTP credentials only through the OS-backed secure
   settings path used by email/push (never plaintext in SQLite or renderer
   state).
2. Keep diagnostics and default logs free of tokens and Authorization headers.
3. Continue redacting credential-like query parameters and URL userinfo on
   export.
4. Do not treat successful authenticated fetch as consent, approval authority,
   or contact trust.

Until that lands, operators who need a private feed should prefer a local or
LAN feed URL without embedding long-lived secrets in the subscription string.
If a token is already present in a URL, export/diagnostics redaction reduces
accidental leakage but is not a substitute for secure storage.

## Future action-bearing feeds

CLV-018 allows feed-derived actions only with:

- an explicit trusted-source policy, and
- local operator confirmation,

and never by treating feed text as trusted commands. That work is out of scope
for 023.

## Operator notes

- Use **Refresh** deliberately; stale health means the last fetch is older than
  twice the configured interval.
- Mute and pause are per source; archive hides items from Latest without
  deleting subscription history until retention applies.
- Failed fetches store a short error on the source card; content-type and
  malformed XML failures do not create signal items.
