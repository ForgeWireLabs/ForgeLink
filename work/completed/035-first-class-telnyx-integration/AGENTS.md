# First-Class Telnyx Integration Agent

## Scope

- Own Telnyx SMS/MMS provider configuration, secure credential handling, provider
  selection, health/status reporting, webhook setup, shared cockpit UX, tests,
  documentation, and evidence.
- Preserve the provider-neutral channel boundary. Telnyx and Twilio remain telecom
  edge adapters; neither becomes the ForgeLink product abstraction.
- Coordinate shared-shell contracts with work item 032. Do not claim Tauri secure-
  storage or local-service parity that has not been implemented and proved there.

## Required checks

- Use deterministic Telnyx API and webhook fixtures; live Telnyx checks remain opt-in.
- Run focused backend, shell, renderer, and Tauri bridge tests for each changed slice.
- Run the complete Electron test suite and `python .local/validate_system.py` before
  closeout.
- Record evidence without credentials, real phone numbers, provider message IDs,
  personal communications, or private webhook URLs.

## Security rules

- Store Telnyx API keys and webhook signing keys only through OS-backed encrypted
  shell storage; never expose their values to the renderer, diagnostics, exports,
  logs, or evidence.
- Keep webhook signature validation mandatory and fail closed when the public key is
  missing or invalid.
- Do not mutate a Telnyx messaging profile until credentials and the selected phone
  number/profile relationship have been validated and the operator saves settings.
- Preserve loopback binding, authenticated private APIs, redacted provider errors,
  local-only operation, and Twilio compatibility.

## Definition of done

Telnyx is first class only when an operator can configure, validate, select, observe,
use, and remove it through the shared cockpit; outbound and inbound behavior is
deterministic; automatic webhook setup is bounded and reversible; secrets remain
protected; and the exact supported Tauri posture is recorded honestly.
