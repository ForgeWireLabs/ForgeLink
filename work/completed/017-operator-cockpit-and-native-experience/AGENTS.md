# Operator Cockpit and Native Experience Planning Agent

## Scope

- Own planning and evidence for ForgeLink's Decisions/People/Agents/Channels
  product experience, triage lanes, operator modes, local presence, mobile
  companion UX, batch approvals, fatigue budget, reputation UI, local summaries,
  scoped MCP resources, reviewed outbox, public screenshots, killer demo, and
  sample workspace.
- Coordinate with work item 015 for runtime/channel/mobile protocol primitives.
- Coordinate with work item 016 for governance schemas and policy semantics.

## Required checks

- Run `python .local/validate_system.py` after plan, manifest, audit, or ledger
  changes.
- Run renderer interaction and accessibility-relevant tests before closing UI
  criteria.
- Use synthetic data for demos, screenshots, fixtures, and sample mode.

## Security rules

- Do not expose real contacts, messages, phone numbers, provider IDs, approval
  evidence, or private screenshots.
- Do not add broad MCP resources that dump private communication history.
- Do not make cloud summarization default for private communications.
- Do not make the first mobile companion a full private-data mirror.

## Definition of done

A criterion is done only when implementation, automated checks, visual/manual
evidence where required, documentation, rollback notes, and remaining-risk notes
are recorded.
