---
id: 0009
title: Channel Roadmap Records and Matrix Exclusion
status: accepted
date: 2026-06-20
supersedes: []
---

# 0009: Channel Roadmap Records and Matrix Exclusion

## Context

Work item 015 (CLV-018) requires roadmap records for future ForgeLink channel
adapters beyond the shipped local channel, Twilio SMS/MMS, Telnyx SMS/MMS, and
Twilio Voice work. These records must describe intended use, privacy/security
notes, likely credentials, inbound/outbound capability, quick-action support,
failure modes, and why Matrix remains excluded from this item.

These are planning records only. No adapter listed here is shipped until it has
an adapter implementation, credential validation, provider-specific inbound
validation, conformance tests, UI/docs, and explicit operator setup.

## Decision

ForgeLink will treat future channels as adapters to the same local-first
communications runtime. The product invariant remains governed human attention
and durable local communication state; external services carry packets but do not
own the product model.

### Email

- **Intended use:** durable/auditable fallback channel for non-urgent operator
  messages, receipts, longer-form contact communication, and low-friction
  outbound notifications where SMS/MMS is unavailable.
- **Privacy/security notes:** email is generally store-and-forward and copied
  through third-party mail infrastructure; message bodies and metadata should be
  treated as exposed to the mailbox provider unless a future encrypted-mail mode
  is explicitly implemented. Diagnostics must exclude bodies and addresses by
  default.
- **Likely credentials:** SMTP host/port/user/password or OAuth token for
  outbound; IMAP/POP/OAuth credentials or webhook provider credentials for
  inbound.
- **Inbound/outbound capability:** outbound first; inbound can later normalize
  mailbox events into local messages if polling or provider webhooks are gated.
- **Quick actions:** possible through structured reply tokens or signed links,
  but not safe to treat as approval authority without anti-replay and explicit
  operator policy.
- **Failure modes:** provider throttling, spam classification, DKIM/SPF/DMARC
  misconfiguration, mailbox polling delays, duplicate inbound fetches, attachment
  size limits, and token expiry.

### Push

- **Intended use:** urgent notification path for operator attention, initially
  through a narrow provider such as ntfy/Pushover-style semantics or a future
  first-party push relay.
- **Privacy/security notes:** push payloads must be redacted by default; the
  local app remains source of truth. Push must not expose message bodies, contact
  data, call details, or approval details unless the operator explicitly changes
  notification policy.
- **Likely credentials:** provider app token, user/device token, topic secret, or
  future first-party relay credential.
- **Inbound/outbound capability:** outbound notifications only at first; inbound
  quick actions require signed responses and replay protection.
- **Quick actions:** approve/deny/dismiss can be considered only with signed
  action payloads tied to a local pending action and expiration.
- **Failure modes:** stale device tokens, delayed delivery, provider outages,
  payload truncation, notification permission revocation, duplicate taps, and
  lost-device risk.

### Telegram

- **Intended use:** developer/demo-friendly bidirectional chat adapter for
  explicitly configured operators or contacts, useful where phone-number SMS is
  not required.
- **Privacy/security notes:** Telegram bot messages are visible to Telegram's
  infrastructure and bot membership rules; bot identities must not be treated as
  trusted contacts without explicit linking and policy.
- **Likely credentials:** bot token, webhook secret, allowed chat IDs or linked
  contact handles.
- **Inbound/outbound capability:** outbound and inbound text; media support later
  after content limits, storage, and diagnostics exclusions are defined.
- **Quick actions:** feasible through inline keyboard callbacks, but callback
  data must be signed, bounded, and mapped to local pending actions.
- **Failure modes:** bot token compromise, spoofed or unlinked chat IDs, webhook
  replay/duplication, rate limits, bot privacy-mode surprises, and media fetch
  failures.

### WhatsApp Business

- **Intended use:** later official business-channel option for contacts who
  prefer WhatsApp, not a primary private operator boundary.
- **Privacy/security notes:** requires business-provider setup and platform
  policy compliance; template messages and business metadata can expose product
  behavior. Trust and approval permissions must remain explicit ForgeLink
  contact policy.
- **Likely credentials:** WhatsApp Business account, phone number ID, access
  token, app secret/webhook verify token, and approved message templates where
  required.
- **Inbound/outbound capability:** inbound and outbound text/media after webhook
  validation and template/gating rules are implemented.
- **Quick actions:** possible with interactive messages, but gated until signed
  local actions and template constraints are implemented.
- **Failure modes:** template rejection, account quality limits, token expiry,
  webhook verification mistakes, opt-in/opt-out requirements, regional policy
  differences, and media retrieval failures.

### Discord

- **Intended use:** team/community chat adapter for non-private operational
  contexts, not the primary personal operator loop.
- **Privacy/security notes:** Discord messages are server/channel scoped and can
  be visible to other members or administrators. Agent approval details must not
  be posted into shared channels by default.
- **Likely credentials:** bot token, application/client ID, public key, guild and
  channel allow-list, webhook interaction secret.
- **Inbound/outbound capability:** outbound messages to allow-listed channels;
  inbound mentions, DMs, slash commands, or interactions only after identity and
  channel policy gates.
- **Quick actions:** feasible with buttons/slash commands, but only for
  allow-listed users/channels and signed local pending actions.
- **Failure modes:** bot permission drift, channel deletion, user/guild identity
  mismatch, rate limits, interaction expiry, moderation deletion, and shared
  channel privacy leaks.

### RSS / Atom

- **Intended use:** inbound trusted-signal/feed adapter, already represented as a
  separate signal lane rather than person-to-person messaging.
- **Privacy/security notes:** feeds are untrusted remote text by default; parsing
  must stay bounded, sanitized, and separate from contact messages. Feed content
  must not gain approval privileges.
- **Likely credentials:** usually none; optional authenticated feeds could later
  require URL tokens or HTTP credentials stored through the secure settings path.
- **Inbound/outbound capability:** inbound only.
- **Quick actions:** not applicable to ordinary feed items; feed-derived actions
  would require an explicit trusted-source policy and local confirmation.
- **Failure modes:** malformed XML, oversized payloads, redirects, duplicate
  items, stale feeds, tracking URLs, content spoofing, and network timeouts.

### Related Future Adapters

- **First-party mobile companion:** native ForgeLink channel for redacted
  notifications and signed approve/deny responses. Covered by decision 0006 and
  remains preferred over third-party chat for the private operator loop.
- **Local webhooks / LAN integrations:** useful for local automation and
  operator-controlled systems, but must remain authenticated and LAN/local by
  default.
- **SIP/direct telecom:** treated separately under CLV-019 because it crosses
  telecom interconnect, regulatory, emergency-calling, caller-ID, and cost
  boundaries.

## Ledger follow-up items

The CLV-018 roadmap is split into detailed active work items so each channel can
be sequenced, implemented, tested, documented, and closed independently:

- `018-email-channel-adapter`: provider-neutral email channel for durable,
  auditable, non-urgent communication.
- `019-push-notification-channel`: redacted urgent notification channel with
  signed quick-action boundaries.
- `020-telegram-channel-adapter`: explicitly linked Telegram bot adapter for
  bidirectional chat and bounded quick actions.
- `021-whatsapp-business-channel`: official WhatsApp Business adapter with
  provider policy, template, and contact-consent gates.
- `022-discord-channel-adapter`: allow-listed Discord team/community adapter
  with interaction-signature and privacy controls.
- `023-rss-atom-signal-follow-up`: feed-signal hardening follow-up that extends
  the completed RSS/Atom signal lane without duplicating it.
- `024-local-webhook-lan-integrations`: authenticated local webhook/LAN adapter
  for operator-controlled local systems.

## Matrix exclusion

Matrix remains excluded from work item 015. It is a capable federated messaging
ecosystem, but it is not the first fit for ForgeLink's current goals:

- it adds federation, homeserver, room-state, device/key-management, and
  moderation complexity before ForgeLink has finished its local-first human loop;
- operator deployments can already use local desktop, MCP/agent channels, mobile
  companion planning, SMS/MMS/voice telecom edges, and future simpler internet
  adapters;
- claiming private or end-to-end encrypted behavior would require a much deeper
  implementation and verification surface than a roadmap record can support;
- no current acceptance criterion requires a Matrix-specific deployment.

Matrix can be reconsidered later only when a concrete operator deployment
requires it and the work item includes explicit homeserver, identity,
encryption, moderation, export/retention, and diagnostics requirements.

## Consequences

- Future channel work has a consistent checklist before any adapter is presented
  as shipped.
- Quick actions are treated as security-sensitive local actions, never as
  ambient trust granted by a chat provider.
- The current product remains local-first and provider-optional while preserving
  roadmap visibility for email, push, Telegram, WhatsApp, Discord, RSS, and
  related adapters.
- Detailed active work items now exist for each CLV-018 follow-up channel path
  so implementation work can start from acceptance criteria instead of a broad
  roadmap note.
