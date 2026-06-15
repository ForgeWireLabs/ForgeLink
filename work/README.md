# Work Ledger

ForgeLink uses RepoPact work items for durable agent work. The older `todos/`
tree remains historical planning context; new cross-cutting product work should
start here unless a narrower existing todo already owns it.

Each work item is a directory containing:

- `README.md`: intent, decisions, scope, acceptance, and closeout narrative.
- `work-item.json`: lifecycle state used by validators and dashboards.
- Optional local artifacts that are too specific to belong in central evidence.

Directory names use `NNN-kebab-case`. IDs are permanent and never reused.

The directory containing a work item is authoritative for lifecycle state. The
JSON status must agree with it.
