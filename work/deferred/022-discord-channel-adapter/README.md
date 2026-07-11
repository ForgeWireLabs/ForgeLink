---
audience: maintainers and implementation agents
status: deferred
last_verified: 2026-07-10
source_of_truth: work/deferred/022-discord-channel-adapter/README.md; work/deferred/022-discord-channel-adapter/work-item.json
---

# Work Item 022: Discord Channel Adapter

## Goal

Add Discord as a team/community channel adapter for status and collaboration contexts. Discord must not become the default private operator approval channel or a place where private agent details are exposed automatically.

## Deferred Status

This work item remains valid but is intentionally deferred as of 2026-07-10.

**Reason:** The shared-channel privacy boundary should not consume priority before local-first integrations, linked-node hardening, and Tauri parity.

**Reactivation condition:** Reactivate when a real allow-listed team or community deployment requires Discord and explicitly accepts the shared-channel privacy boundary.

No implementation is authorized while this item is deferred. Its acceptance criteria
remain pending, and its work-item ID remains permanently reserved.

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

