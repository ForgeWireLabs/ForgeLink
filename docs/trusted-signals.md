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
- Bounded fetch: http(s) only, single 8s deadline across redirects, at most 3
  redirects, 1 MB response cap, content-type checks. Operator-entered LAN/private
  feed URLs are allowed; public feeds may not redirect into loopback, private,
  link-local, multicast, unspecified, or cloud-metadata addresses, and HTTPS→HTTP
  downgrades are rejected.
- Well-formed RSS/Atom XML only (DTD/entity declarations rejected; truncated or
  mismatched markup fails closed). Text-only item extraction; duplicate external
  IDs ignored; tracking and credential query parameters stripped from item links;
  URL-fallback identities are hashed.
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

Ordinary feeds need no credentials. Subscription URLs that include HTTP
userinfo or credential-like query parameters (`token`, `api_key`, `password`,
etc.) are **rejected**. Legacy rows are scrubbed on open (credentials stripped,
source paused). This is not authenticated-feed support.

Optional authenticated feeds remain **future** and must satisfy:

1. Store URL tokens or HTTP credentials only through the OS-backed secure
   settings path used by email/push (never plaintext in SQLite or renderer
   state).
2. Keep diagnostics, API DTOs, `last_error`, and default logs free of tokens and
   Authorization headers.
3. Continue redacting credential-like query parameters and URL userinfo on
   export (including URL-shaped `external_id` values).
4. Do not treat successful authenticated fetch as consent, approval authority,
   or contact trust.

Until that lands, use a credential-free feed URL (public or operator-chosen LAN).

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
- Failed fetches store a short **sanitized** error on the source card (URLs and
  secrets redacted); content-type and malformed XML failures do not create signal
  items.
