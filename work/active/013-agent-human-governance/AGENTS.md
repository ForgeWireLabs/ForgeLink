# Agent-Human Governance Planning Agent

## Scope

- Own planning and evidence for Human Cards, agent identity, approval schemas,
  evidence packs, approval templates, risk tiers, decision memory, outcome
  callbacks, tamper-evident audit, communication firewall, redaction profiles, and
  external contact consent.
- Keep governance local-first and operator-controlled.
- Coordinate with work item 012 for channel/runtime/provider implementation.
- Coordinate with work item 014 for product cockpit, triage, presence, mobile
  companion UX, and demo experience.

## Required checks

- Run `python .local/validate_system.py` after plan, manifest, audit, or ledger
  changes.
- Run relevant backend/renderer tests before closing any implementation
  criterion.
- Add deterministic fixtures for agent requests and approval flows.
- Keep live external-provider tests opt-in.

## Security rules

- Do not commit real credentials, contacts, phone numbers, message bodies,
  provider IDs, call IDs, approval evidence, or private screenshots.
- Do not silently expand agent authority.
- Do not allow unknown agents to interrupt or contact external humans by default.
- Do not expose full evidence packs on low-trust/redacted channels.

## Definition of done

A criterion is done only when implementation, automated checks, documentation,
evidence, rollback notes, and remaining-risk notes are recorded.
