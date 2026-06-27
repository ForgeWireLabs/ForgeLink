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
