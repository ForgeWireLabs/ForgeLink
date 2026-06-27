# Operator Cockpit

ForgeLink's primary desktop navigation is organized around operator intent:

- **Decisions** is the first surface. Approval requests and other action-required
  agent messages appear here instead of being buried in ordinary conversations.
- **People** is the human directory. Contact records and relationship metadata
  are managed separately from channels and agent decisions.
- **Agents** shows local agent status, channel health, and recent agent request
  sources. It is not the approval queue.
- **Channels** is the communication hub. Messages, calls, trusted signals, and
  provider/channel readiness are reachable from here.

Messages remain available from Channels -> Messages. Calls and trusted signal
feeds are also available from Channels. Settings remains the place for local
service health, data safety, provider credentials, attention policy, and detailed
agent-channel credential actions.

This split keeps communication, approvals, agent status, and channel
configuration visible as distinct product surfaces.

## Shared Shell Boundary

The renderer reaches native desktop/mobile capabilities through the ForgeLink
shell bridge, not through direct Electron APIs. The current Electron preload
exposes `forgeLinkShell` and keeps the older `desktop` name only as a
compatibility alias. Future Tauri desktop and mobile shells should implement the
same bridge for local service connection, notifications, external links,
settings/onboarding lifecycle, attention policy, MCP token actions, and agent
channel credential actions.

This keeps Decisions, People, Agents, and Channels portable across the current
Electron desktop shell and the Tauri 2 shared shell planned in work item 030.

## Operator Modes And Presence

Settings includes explicit operator modes:

- Available
- Focus
- Driving
- Sleeping
- Family
- Work
- Emergency-only
- Offline

The mode is part of the local attention policy. It influences whether an
interruption is delivered immediately, deferred/batched, redacted, or recorded
without notification. Focus, family, and work modes allow higher-priority agent
interruptions; driving, sleeping, emergency-only, and offline are stricter. Any
non-available mode forces notification redaction even if body previews are
otherwise enabled.

ForgeLink also shows local presence signals in Settings: app focus, recent input
activity, network state, manual do-not-disturb, and paired-mobile proximity. The
signals are operator-visible and configurable. ForgeLink does not collect hidden
location, calendar, microphone, camera, or background surveillance data for this
phase.

## Emergency Boundaries

Emergency behavior is policy-gated. Agents cannot turn an ordinary urgent
request into an emergency by setting an unstructured flag; the backend rejects
agent emergency claims unless the request also carries emergency authority or
emergency/critical risk through the governed approval fields. Emergency requests
can bypass quiet hours and mode suppression only when they satisfy that policy.

Emergency contact bypass is an explicit local attention-policy setting. It does
not grant agents new authority and does not override contact policy, trust state,
or approval requirements.

## Decision Triage

The Decisions surface is split into lanes:

- Needs decision
- Waiting on agent
- Informational
- Failed / repair
- Muted
- Expired
- Completed

ForgeLink derives these lanes from the existing local record fields: message
kind, status, available actions, expiry, `last_error`, and muted source/channel
policy. This keeps agent requests out of ordinary human message threads and
makes failed, expired, muted, and completed work visible without mixing them
with live approvals.

## People Grouping

The People surface groups local contacts by relationship and trust:

- Operator
- Family
- Trusted humans
- External contacts
- Agents
- Systems
- Unknown
- Blocked

The grouping uses local contact metadata such as `trust_level`, tags, role, and
company. Unknown and blocked contacts are rendered in distinct sections so they
do not look like ordinary trusted people.
