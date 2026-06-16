# 008 - RSS And Trusted Signals Adapter

> **Status**: Completed 2026-06-16.
> **Owners**: Data Agent, Backend Agent, UI Agent, Security Agent.
> **Depends on**: Work item `007`.

## Intent

Bring RSS and trusted non-social signals into ForgeLink without recreating a
social media feed. Signals should be useful, bounded, recoverable, and clearly
separate from direct human messages and agent approval requests.

## Product Principle

Signals are not a competition for attention. ForgeLink should help the human
receive chosen updates without engagement ranking, public identity performance,
or infinite scroll habits.

## In Scope

- Feed subscription storage.
- RSS/Atom parsing with duplicate detection.
- Fetch scheduling or manual refresh.
- Failure states and retry/backoff.
- Separate `signals` persistence model.
- Retention and export/backup coverage.
- UI surface with pause, mute, archive, and source controls.
- Review of the old PySide/Qt RSS app if it can be found in the repo
  collection.

## Out Of Scope

- Social media APIs.
- Likes, follows, reposts, ranking, comments, or recommendations.
- Rendering untrusted active content.
- Mobile push behavior unless separately approved.

## Security Notes

- Feed content is untrusted.
- External links open outside the renderer.
- Fetches need timeouts, size limits, redirect limits, and clear user-visible
  failure states.
- Feed item bodies may contain personal or sensitive content and must follow
  backup/export sensitivity rules.

## Closeout Evidence

Completed with:

- Schema version 7 `signal_subscriptions` and `signal_items` tables.
- Launch-authenticated signal subscription, refresh, pause, mute, item list, and
  archive endpoints.
- TypeScript RSS/Atom parsing and bounded fetching with URL protocol checks,
  timeout, redirect cap, 1 MB response cap, content-type handling, duplicate
  detection, and text-only summaries.
- Dedicated Signals renderer surface with source controls and a bounded latest
  list, separate from SMS conversations and agent decisions.
- Backup/export/recovery through SQLite plus global and per-subscription
  retention behavior.
- Evidence in `evidence/runs/20260615-rss-trusted-signals-adapter.json`.

## Old App Review

Located the historical PySide6 RSS app at
`C:\Projects\SCOUT-2\modules\Personas\FeedManager\Toolbox\Feed_Portal`.
Relevant files reviewed:

- `Feed_Portal.py`
- `modules/rss_feed_reader.py`
- `modules/feed_entry_frame.py`
- `feeds.json`

Useful behavior carried forward: feed URL storage, categories/titles as source
identity, manual refresh, entry details, sorting concepts, external browser
opening, and persisted feed JSON. ForgeLink intentionally does not import that
Python runtime or render feed HTML; the old `feeds.json` demonstrated one
TechCrunch feed subscription, but this implementation starts with explicit
ForgeLink-managed subscriptions instead of automatic import.

## Verification

- `cd Electron && npm test`
- `cd Electron && npm run screenshot`
- `python scripts/validate_repo.py --root .`
- `python .local/validate_system.py`

## Security Notes

Feed content is treated as untrusted text. The renderer does not execute or
render feed HTML, external item links use the desktop external opener, failed
fetch states are stored on the subscription, and signal items are exported as
private local data alongside messages while remaining in their own tables.
