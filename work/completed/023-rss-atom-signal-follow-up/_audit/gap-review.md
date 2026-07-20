---
audience: maintainers
status: complete
last_verified: 2026-07-20
source_of_truth: work/completed/023-rss-atom-signal-follow-up/_audit/gap-review.md
---

# RSSF-001 Gap Review (008 vs CLV-018)

Compared completed work item 008, `Electron/backend/src/signals.ts`, Signals UI,
decision 0009 RSS/Atom notes, and CLV-018 follow-up expectations.

## Already shipped by 008 (do not duplicate)

- Subscription storage, manual refresh, pause/mute/archive UI
- Bounded fetch (timeout, redirects, 1 MB, content-type)
- Separate signal tables, backup/export/retention
- Quiet attention defaults; UI separated from people/agent queues
- Text-only parse and duplicate external IDs

## Gaps closed in 023

| CLV-018 / RSSF concern | 023 action |
| --- | --- |
| Tracking URLs | Strip common tracking query params on item links |
| Stale feeds | Health classifier + UI label (2× interval) |
| Malformed XML / oversize / redirects | Stronger parse rejection + deterministic fixtures |
| Boundary: not person-to-person / not approvals | Docs + UI copy + API/UI tests |
| Authenticated feeds | Plan-only in `docs/trusted-signals.md` (secure storage required) |
| Export / diagnostics leakage | URL secret redaction on export; counts-only diagnostics |
| Action-bearing feeds | Explicitly deferred; no approval/quick-action path |

## Remaining risks (accepted)

- Automatic scheduled refresh still not running (manual Refresh only).
- No SSRF private-IP blocklist (local/LAN feeds remain useful for operators).
- Authenticated feeds not implemented; URL-token redaction is defense-in-depth only.
- Regex XML parser remains intentionally simple; exotic namespace feeds may fail closed.
