# 008 Alignment Report

Updated: 2026-06-16

## Alignment

- Product principle: Signals are private, local, recoverable data and do not compete with direct human messages or agent approvals.
- Architecture: Renderer uses the local backend API through `PhoneApi`; backend owns feed fetching and persistence; external links open through the desktop bridge.
- Data: Schema v7 adds separate signal tables with export, backup, retention, and migration coverage.
- Security: Fetching is bounded, feed content is stored/rendered as text, and launch-token-only routes manage subscriptions.

## Remaining Risk

- Automatic scheduled refresh is intentionally not running in the background yet; manual refresh is implemented, and attention policy work belongs to `009`.
