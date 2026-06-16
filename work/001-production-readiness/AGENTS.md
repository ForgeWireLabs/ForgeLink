# Production Readiness Planning Agent

## Scope

- Own planning and evidence for the production-readiness program.
- Do not mark implementation complete from code inspection alone.
- Keep work-item IDs stable even if phases are reordered.

## Required checks

- Run the acceptance commands named by the work item.
- Run `python .local/validate_system.py` after plan or audit changes.
- Update `_audit/inventory.md` and `_audit/alignment-report.md` with every status change.

## Definition of done

A work item is done only when implementation, automated checks, manual evidence where required, documentation, and remaining-risk notes are recorded.
