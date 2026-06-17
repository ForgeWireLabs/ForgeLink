# Work Ledger

ForgeLink uses RepoPact work items for durable agent work. The pre-ledger
`todos/` tree has been migrated into this ledger (its production-readiness plan
is now `work/active/011-production-readiness/`); all new cross-cutting product
work starts here.

Each work item is a directory containing:

- `README.md`: intent, decisions, scope, acceptance, and closeout narrative.
- `work-item.json`: lifecycle state used by validators and dashboards.
- Optional local artifacts that are too specific to belong in central evidence.

Directory names use `NNN-kebab-case`. IDs are permanent and never reused.

The directory containing a work item is authoritative for lifecycle state. The
JSON status must agree with it.

## Preflight Rule

Numbered implementation work must be added to the work ledger before coding,
testing, docs, release, or repo mutation starts. The first change for a new
piece of durable work is creating its `work/active/NNN-*` or
`work/deferred/NNN-*` directory with pending acceptance criteria.

Work items `010` and later must include:

```json
"preflight": {
  "created_before_work_started": true,
  "created_at": "YYYY-MM-DDTHH:MM:SSZ",
  "note": "Created before implementation work started."
}
```

Items `000` through `009` are legacy with respect to this marker. Work items
`008` and `009` were completed with retroactive ledger handling; `010` adds the
guardrail so that miss is visible and not repeated.
