# ForgeLink: Human-Boundary Infrastructure

ForgeLink is the private boundary where trusted systems ask for human attention,
authority, and decisions — and where a human operator reviews, approves, denies,
defers, replays, and audits what happened.

It is **not** another chat feed, a hosted notification relay, or an agent runner.
It is the governed place where a system asks, a human decides, and the outcome is
recorded.

> Agent messages are communications, not content. Telecom providers are adapters,
> not the product.

## The four operator surfaces

- **Decisions.** Action-required requests with evidence packs (intent, requested
  action, risk, diff/release summary, checks, rollback), triage lanes
  (needs-decision, waiting, informational, failed, muted, expired, completed),
  batch review, a human fatigue budget, and advisory local thread summaries.
- **People.** A human directory grouped by relationship and trust, kept separate
  from channels and agent decisions.
- **Agents.** Agent identity, trust state, channel health, and advisory reputation
  — never an automatic grant of authority.
- **Channels.** Messages, voice, trusted signals, the reviewed outbox for
  agent-drafted external messages, channel redaction previews, and the mobile
  cockpit. SMS/MMS/voice/email/chat providers are edges.

## Positioning

- **Local-first.** Private communication and decision state lives on the operator's
  machine; ForgeLink is usable with no telecom provider configured.
- **Governed.** Every approval carries an evidence pack, a recorded decision, an
  agent-reported outcome, a tamper-evident audit chain, and a replay.
- **Boundary, not feed.** Redaction profiles control what each surface (desktop,
  mobile lock screen, email, SMS, status) reveals.
- **One product across surfaces.** Desktop and mobile share the same cockpit; the
  redacted decision terminal is a restricted mobile mode, not the whole product
  ([decision 0017](../decisions/0017-mobile-is-a-full-cockpit.md)).

## Synthetic screenshots

All public screenshots use synthetic, redacted data only — no real contacts,
messages, phone numbers, provider IDs, or approval evidence.

Generate them reproducibly from the visual-smoke harness, which runs the app
against the synthetic `.visual-smoke-data` workspace with notification-body
redaction enabled:

```bash
cd Electron
npm run screenshot
```

This captures the cockpit surfaces (run on a desktop session with a display; the
harness uses Electron `capturePage`). Output is written to `Electron/dist/`:

| Asset | Surface |
| --- | --- |
| `ui-cockpit-decisions.png` | Decisions (triage lanes, evidence, batch review) |
| `ui-cockpit-people.png` | People (relationship/trust groups) |
| `ui-cockpit-agents.png` | Agents (identity, trust, health, reputation) |
| `ui-cockpit-channels.png` | Channels (messages, voice, signals, outbox, mobile) |
| `ui-preview.png` | Settings / attention policy |
| `ui-contact-timeline-preview.png` | Redaction-aware contact timeline |

For publishing, copy the chosen synthetic shots into `assets/readme/` and reference
them from the README. The first-run [sample workspace](operator-cockpit.md#sample-workspace)
(Settings → Sample workspace) provides additional clearly-synthetic data for live
walkthroughs, and the reproducible [killer demo](killer-demo.md) narrates the full
decision lifecycle without any telecom credentials.
