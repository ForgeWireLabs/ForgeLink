# Provider-Specific Communications Experience Agent

## Scope

- Own the shared renderer experience that presents Twilio and Telnyx as distinct
  provider integrations with different configuration, capabilities, health, and
  operator actions.
- Keep the runtime send contract provider-neutral while keeping provider APIs and
  capability claims explicit.
- Reuse the shared React renderer for Electron and Tauri. Do not add an Electron-only
  UI fork or claim Tauri provider storage/runtime parity owned by work item 032.

## Required checks

- Add renderer interaction tests for first-run provider choice, provider-specific
  setup, capability presentation, and active-provider status.
- Run the renderer build and focused renderer tests after each completed UI slice.
- Run the complete Electron suite and `python .local/validate_system.py` before
  closeout.
- Record only synthetic/redacted screenshots or fixtures; do not capture real
  credentials, phone numbers, messages, profile IDs, account IDs, or webhook URLs.

## Product and security rules

- Do not flatten Twilio and Telnyx into a generic credentials form. Twilio owns its
  Account SID/Auth Token/number/voice model; Telnyx owns its API key/messaging
  profile/Ed25519 webhook-key model.
- Capability labels must describe what ForgeLink actually implements, not the full
  commercial provider catalog.
- Secrets remain shell-owned and must never be returned to or rendered by React.
- Preserve local-only onboarding and make it the default no-provider path.

## Definition of done

The shared cockpit has distinct Twilio and Telnyx setup flows, correct provider health
and capability presentation, explicit active-edge context on messaging surfaces, and
tests proving the UI does not regress to Twilio-shaped provider assumptions.
