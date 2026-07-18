# RepoPact 2.2.0 Formal Release Agent

## Scope

- Own the dependency transition from the interim dashboard-integrity commit pin to
  the formal `repopact==2.2.0` PyPI release, validation, evidence, and closeout.

## Required checks

- Install with `python -m pip install --no-cache-dir -r requirements-repopact.txt`.
- Confirm installed metadata reports RepoPact 2.2.0 from PyPI.
- Regenerate the dashboard through the packaged CLI and run
  `python .local/validate_system.py`.
- Run the repository pre-push gate before closeout.

## Constraints

- Do not weaken canonical dashboard validation or hand-edit the dashboard.
- Do not retain a floating version, branch, or interim git dependency.
- Record PyPI and upstream tag identity without copying credentials into evidence.
