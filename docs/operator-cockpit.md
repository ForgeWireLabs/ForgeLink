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

## Tauri Mobile Decision Terminal

The first mobile surface is a Tauri 2 decision terminal, not a chat clone and
not a private database mirror. It is reached from Channels -> Mobile terminal in
the shared cockpit UI so the same React/Web surface can move into the Tauri
desktop/mobile shell owned by work item 030.

The MVP mobile card includes:

- paired device state and local presence signal;
- redacted alert content using the mobile lock-screen profile;
- approval-card actions for approve, deny, defer, request more info, and short
  reply;
- emergency contact toggle state from the attention policy;
- explicit device revoke control.

Desktop remains the source of truth for private local data. Mobile receives a
redacted decision card, signs the selected decision with the paired device key,
and returns only the decision envelope. Desktop verifies the request hash,
evidence hash, device trust, and revocation state before recording the decision
and audit trail.

For the MVP, mobile does not replicate the private communications database,
contact history, evidence body, local exports, or provider credentials.

## Reducing Interruption Cost

The Decisions surface includes a batch approvals panel for low and medium risk
approval requests. The panel can select all batchable requests, approve all,
approve selected, or deny all. Individual cards remain visible below the batch
panel so the operator can inspect requests before acting. Batch actions still
call each request's existing action endpoint, preserving individual outcome and
audit records instead of creating a hidden group decision.

The Decisions surface also shows a local fatigue budget derived from existing
agent-message records:

- interruptions today;
- urgent or high-priority interruptions today;
- denied requests;
- expired requests;
- average response time where decision timestamps are available;
- repeated sources that interrupted more than once today.

The fatigue budget can recommend batching, deferring, muting, or reviewing noisy
agents, but it does not silently suppress or approve work.

The Agents surface includes advisory reputation rows per source. Reputation uses
approval, denial, expiration, malformed-request, failed/scope-flag, and urgent
request signals. It is product guidance only: reputation can inform review and
suggestions, but it never grants authority automatically.

## Local Thread Summaries

ForgeLink derives a local, advisory summary for any message thread. The summary
is built on the desktop from records already in the local database with a
deterministic, extractive pass — there is no model call, and cloud summarization
is opt-in only and not enabled in this build. A summary is a derived artifact,
never a source of truth.

Each summary covers what happened, open decisions (unanswered inbound
questions), pending replies, the last operator action, and agent-relevant
constraints. The operator-facing summary includes a few short, sanitized message
excerpts for context.

Summaries treat all thread content as untrusted (see Summary Safety). They are
advisory: they carry no authority, change no policy, and never encode an action.
Endpoint: `GET /api/threads/:id/summary` (operator surface).

## Summary Safety

Thread content is untrusted input. Summaries defend against prompt injection from
message bodies:

- Every excerpt passes through the agent-content sanitizer, which strips control
  and bidi characters and defangs lines that impersonate system/operator/ForgeLink
  prompts.
- Excerpts are short, length-capped, and explicitly labeled as quoted untrusted
  content.
- Each summary carries explicit provenance (`derived_local_summary`), an
  untrusted-content marker, and an advisory notice; it always reports
  `authority: "none"`.
- Nothing in a summarized thread can grant authority, approve a request, or
  trigger an action.
- Any future cloud summarizer must be opt-in and must use the injection-resistant
  framing documented alongside the local summarizer; no cloud path is wired up.

## Scoped Agent Resources

Agents and MCP clients read scoped, derived resources instead of raw
communication history. There is intentionally no dump-all-messages resource.

- `get_pending_approvals` / `GET /api/pending-approvals` — approvals waiting on
  the operator, with titles and routing fields only. No message body or evidence
  pack.
- `get_contact_summary` / `GET /api/contacts/summary` — relationship, trust, and
  derived activity counts. Never message bodies or phone numbers.
- `get_thread_summary` / `GET /api/threads/:id/summary?scope=agent` — the scoped
  thread summary, which omits all message excerpts.
- `get_agent_status` / `GET /api/agent-status` — advisory trust and reputation
  derived from local history; it does not grant authority or auto-decide.

The scoped summary served to agents drops the message excerpts that the operator
summary includes, so a scoped resource can never become a raw communication dump.

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
