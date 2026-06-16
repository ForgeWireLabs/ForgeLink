# 008 - RSS And Trusted Signals Adapter

> **Status**: Deferred.
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

Close with parser tests, database tests, renderer tests, visual screenshot,
security notes, and a record of whether the old RSS app was found and mined for
subscription import behavior.
