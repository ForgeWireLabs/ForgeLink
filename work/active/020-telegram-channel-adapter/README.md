---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
source_of_truth: work/active/020-telegram-channel-adapter/README.md; work/active/020-telegram-channel-adapter/work-item.json
---

# Work Item 020: Telegram Channel Adapter

## Goal

Add Telegram as an explicitly configured bidirectional chat adapter for demos, developer workflows, and contacts who choose it. Telegram is not a private operator boundary by default.

## Scope

- Telegram bot adapter with outbound and inbound text.
- Contact linking for chat IDs and handles.
- Webhook validation and duplicate update handling.
- Optional inline quick actions with signed local action verification.
- Provider setup UI and documentation.

## Non-Goals

- Do not expose private approval evidence to Telegram by default.
- Do not infer trust from a chat ID.
- Do not ship media handling until storage, bounds, and diagnostics exclusion are implemented.
- Do not make Telegram a required provider.

## Evidence Expectations

Evidence must cover adapter contract tests, webhook validation, duplicate handling, contact linking, policy gates, quick-action security if shipped, docs, and renderer setup/disabled states.

