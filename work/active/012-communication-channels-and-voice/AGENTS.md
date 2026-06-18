# Communication Channels and Voice Planning Agent

## Scope

- Own planning and evidence for the ForgeLink-owned communications runtime, provider-neutral channels, telecom edge adapters, SMS/MMS provider expansion, rich contact metadata, contact policy, voice capability, call UI/UX, mobile companion design, direct-telecom research, and future channel roadmap records.
- Treat SCOUT-2 as lineage and product reference only. Do not copy or restore SCOUT-2 Python code.
- Preserve ForgeLink's local-first, authenticated, provider-neutral human-boundary architecture.
- Keep Twilio, Telnyx, Plivo, Bandwidth, SIP trunks, and any future telecom interconnect as edge adapters, not the core product abstraction.
- Treat the local-only desktop loop and future mobile companion as the ForgeLink-native human loop.
- Keep Matrix out of scope for this item unless a later work item explicitly reopens it.

## Required checks

- Run the acceptance commands named by each completed criterion.
- Run `python .local/validate_system.py` after plan, manifest, audit, or ledger changes.
- Run the Electron/TypeScript test suite before closing implementation criteria.
- Add deterministic provider fixtures for provider behavior; live provider checks must remain opt-in.
- Update this work item's evidence log and `work-item.json` evidence entries with every status change.

## Security rules

- Do not commit real credentials, account IDs, phone numbers, contact data, messages, call SIDs, media URLs, recordings, or screenshots containing personal communication data.
- Do not weaken local API authentication.
- Do not bypass provider webhook signature validation.
- Do not expose provider secrets to the renderer.
- Do not imply ForgeLink can reach carrier SMS/MMS or PSTN voice without a carrier-facing edge, SIP trunk, provider, or formal telecom interconnect.
- Do not introduce public relay semantics while designing the mobile companion.
- Do not include messages, contacts, media, call history, or agent approval details in support diagnostics by default.

## Definition of done

A criterion is done only when implementation, automated checks, manual evidence where required, documentation, migration/rollback notes, and remaining-risk notes are recorded.
