---
id: 0001
title: Adopt RepoPact Alongside Local Todos
status: accepted
date: 2026-06-15
supersedes: []
---

# 0001: Adopt RepoPact Alongside Local Todos

## Context

ForgeLink already had a local `todos/` operating layer inherited from the Twilio
Phone production-readiness work. The operator wants RepoPact adopted across
projects to prove its value, but not by overwriting useful project history.

## Decision

Adopt RepoPact as an additive governance and work ledger for ForgeLink. Keep
`todos/` as historical planning context and use `work/` for new RepoPact work
items going forward.

## Alternatives considered

- **Run RepoPact bootstrap directly.** Rejected because it would overwrite
  ForgeLink's existing root `AGENTS.md` and README, weakening project-specific
  context.
- **Keep only local todos.** Rejected because it would leave ForgeLink outside
  the RepoPact proof path.

## Consequences

ForgeLink now has validator-backed work items, evidence records, and governance
invariants while preserving its existing local instructions and planning
artifacts.
