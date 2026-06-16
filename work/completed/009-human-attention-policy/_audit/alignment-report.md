# 009 Alignment Report

Updated: 2026-06-16

## Alignment

- Product principle: ForgeLink keeps communication personal by separating direct messages, agent requests, trusted signals, and system notices instead of creating a hidden engagement feed.
- Architecture: Renderer sends structured notification events through the preload bridge; the desktop process owns the policy decision before invoking OS notifications.
- Data: Attention policy persists in local desktop settings and is normalized on load/save with private defaults.
- Security: Notification bodies are redacted by default, and unredacted text is still scrubbed for phone numbers, Twilio SIDs, ForgeLink tokens, and URLs.

## Remaining Risk

- Local OS notification history may retain displayed titles/bodies after delivery. Future mobile push or remote bridge work must reuse this policy layer instead of introducing a second notification decision path.
