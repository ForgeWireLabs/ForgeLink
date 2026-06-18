---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-18
source_of_truth: Electron/tunnel.js; Electron/main.js; Electron/onboarding.js
---

# Work Item 014: Automatic public webhook via cloudflared quick-tunnel

## Goal

Inbound SMS should work with zero user webhook setup (work item 013 hid the
field). The app provisions its own public URL and points Twilio at it.

## Approach

- **cloudflared quick-tunnel** (operator decision). `Electron/tunnel.js` resolves
  a `cloudflared` binary — cached under the Electron user-data dir, fetched once
  from the official release if missing — then runs
  `cloudflared tunnel --url http://127.0.0.1:<port>` and parses the
  `https://*.trycloudflare.com` URL from its output.
- On `start-server`, after credentials validate and only when no manual
  `public_base_url` is set, the app sets the Twilio number's `SmsUrl` to
  `<tunnel>/webhooks/sms` via the Twilio REST API (same Basic-auth pattern as
  `validateTwilioCredentials`) and restarts the backend with
  `TWILIO_PUBLIC_BASE_URL` so outbound status callbacks resolve.
- Quick-tunnel URLs are ephemeral, so this re-provisions every launch. The tunnel
  process is stopped on quit / stop-service.

## Constraints

- Private-first (INV-4/INV-5): the tunnel forwards only to loopback; a manual
  webhook URL still overrides; no secrets logged.
- Packaging: cloudflared is acquired at runtime and cached (keeps the binary out
  of git and the installer); a future change may bundle it for offline installs.

## Verification

Unit tests cover URL parsing and the Twilio webhook request shaping; the app
launch and tunnel/webhook provisioning are observed live. End-to-end inbound
depends on the operator's live Twilio account.

## Acceptance

Lifecycle and evidence live in [`work-item.json`](work-item.json).
