---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
source_of_truth: work/active/022-discord-channel-adapter/README.md; work/active/022-discord-channel-adapter/work-item.json
---

# Work Item 022: Discord Channel Adapter

## Goal

Add Discord as a team/community channel adapter for status and collaboration contexts. Discord must not become the default private operator approval channel or a place where private agent details are exposed automatically.

## Scope

- Discord bot/application setup.
- Allow-listed guilds, channels, and users.
- Outbound status/team messages.
- Optional inbound interactions after identity and policy gates.
- Optional quick actions with signed local pending-action verification.

## Non-Goals

- Do not post private approval evidence to shared channels by default.
- Do not infer authority from Discord role membership alone.
- Do not support arbitrary guilds or channels without explicit allow-listing.
- Do not require Discord for core ForgeLink operation.

## Evidence Expectations

Evidence must prove credential safety, allow-list enforcement, redaction, provider failure handling, quick-action security if shipped, renderer setup states, and docs.

