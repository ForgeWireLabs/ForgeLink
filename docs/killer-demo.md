# Killer Demo

A reproducible, ~2-minute demonstration of what ForgeLink is: the governed place
where a system asks, a human decides, and the outcome is recorded and replayable.

It runs entirely on **synthetic data** against a **local backend** and needs **no
telecom credentials** and no network access.

## Run it

```bash
cd Electron
npm run demo
```

`npm run demo` builds the backend and runs
[`scripts/killer-demo.js`](../Electron/scripts/killer-demo.js), which starts a
throwaway local ForgeLink backend in a temp directory, drives the full decision
lifecycle over the real local API, prints a narrated transcript, and tears the
backend down. The same flow is asserted by `killer-demo.test.js` so it stays
reproducible.

## The flow

1. **Provision an agent channel.** A local agent-channel credential is issued for a
   ForgeWire/Codex-style agent (the credential itself is never printed).
2. **Agent requests approval to publish a GitHub release.** The request carries a
   structured evidence pack — summary, diff summary, version/release notes, checks,
   and a rollback plan — and lands on the **Decisions** surface, not in an ordinary
   conversation.
3. **Mobile gets a redacted alert.** The same request rendered through the mobile
   lock-screen redaction profile shows the title only; the body is redacted.
4. **Operator approves** on the desktop cockpit. The decision is recorded with the
   operator alias and committed to the tamper-evident audit chain.
5. **Agent publishes and reports the outcome** (`action_succeeded`) back to
   ForgeLink.
6. **ForgeLink replays the audited lifecycle** — request → risk classification →
   evidence → decision → reported outcome → final state — and verifies the audit
   chain.

The demo asserts a clean end state: the request was decided, the outcome is
`action_succeeded`, and the audit chain verifies.

## Safety

- All data is synthetic and clearly marked `(sample)`; no real repository, contact,
  message, or credential is touched.
- The backend runs locally in a temporary directory that is deleted on exit.
- No telecom provider, tunnel, or external service is required or contacted.
