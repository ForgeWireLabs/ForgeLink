# RepoPact Workflow For ForgeLink

1. Capture intent in `work/active/NNN-slug/`.
2. Name the owner scope and affected scopes before implementation.
3. Record hard-to-reverse choices in the work item; promote durable decisions to
   `decisions/`.
4. Implement within scope.
5. Produce evidence under `evidence/runs/`.
6. Satisfy or waive acceptance criteria with rationale.
7. Move completed work to `work/completed/` without rewriting history.

The existing `todos/` tree remains valid local planning history. RepoPact does
not erase it; it gives new work a standard lifecycle and validation surface.
