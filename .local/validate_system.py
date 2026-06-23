"""ForgeLink local extension to RepoPact validation (work item 026).

RepoPact's vendored validator (``scripts/validate_repo.py``) is authoritative for
governance records: contracts, owners, work items, formal evidence runs, the audit
registry, decisions, and policies. This script runs it first and fails if it
fails, then layers the ForgeLink-only structural checks RepoPact does not cover:

- LIE-001 README <-> work-item.json checkbox parity (satisfied -> [x], pending -> [ ]);
- LIE-003 the decision 0011 schema-migration ladder invariants;
- markdown link resolution and a non-future ``last_verified`` date.

The previous lightweight evidence-log check (LIE-002) is retired: RepoPact's formal
``evidence/runs/*.json`` requirement supersedes it. Keeping both validators in one
entry point is deliberate so a single ``python .local/validate_system.py`` (and the
git hooks that call it) cannot pass while the authoritative validator fails.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CHECKBOX = re.compile(r"-\s*\[([ xX])\]\s*\*\*([A-Z]+-\d+)\b")
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
LAST_VERIFIED = re.compile(r"^last_verified:\s*(\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)


def run_repopact(errors: list[str]) -> None:
    """Run the authoritative RepoPact validator and fold its failures in."""
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_repo.py"), "--root", str(ROOT)],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return
    surfaced = False
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("ERROR"):
            errors.append(f"repopact: {stripped[len('ERROR'):].strip()}")
            surfaced = True
    if not surfaced:
        detail = (result.stdout or result.stderr or "").strip()[:400]
        errors.append(f"repopact validation failed: {detail}")


def iter_work_items():
    for lifecycle in ("active", "completed", "deferred"):
        directory = ROOT / "work" / lifecycle
        if not directory.is_dir():
            continue
        for item in sorted(directory.iterdir()):
            if item.is_dir() and (item / "work-item.json").is_file():
                yield item


def check_checkbox_parity(item: Path, errors: list[str]) -> None:
    """LIE-001: where a README uses the checklist convention, its checkboxes must
    match the manifest criterion states."""
    readme = item / "README.md"
    if not readme.is_file():
        return
    try:
        data = json.loads((item / "work-item.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return  # RepoPact reports manifest parse errors authoritatively.
    text = readme.read_text(encoding="utf-8")
    boxes = {match.group(2): match.group(1).strip().lower() for match in CHECKBOX.finditer(text)}
    if not boxes:
        return
    rel = readme.relative_to(ROOT)
    for criterion in data.get("acceptance_criteria", []):
        if not isinstance(criterion, dict):
            continue
        criterion_id = str(criterion.get("id"))
        state = criterion.get("state")
        box = boxes.get(criterion_id)
        if box is None:
            errors.append(f"criterion {criterion_id} has no README checkbox: {rel}")
        elif state == "satisfied" and box != "x":
            errors.append(f"criterion {criterion_id} is satisfied but its README checkbox is unchecked: {rel}")
        elif state == "pending" and box == "x":
            errors.append(f"criterion {criterion_id} is pending but its README checkbox is checked: {rel}")


def check_schema_ladder(errors: list[str]) -> None:
    """LIE-003: enforce the decision 0011 schema-migration invariants."""
    database = ROOT / "Electron" / "backend" / "src" / "database.ts"
    decision = ROOT / "decisions" / "0011-schema-migration-coordination.md"
    if not database.is_file():
        return
    text = database.read_text(encoding="utf-8")
    match = re.search(r"CURRENT_SCHEMA_VERSION\s*=\s*(\d+)", text)
    if not match:
        errors.append("schema ladder: CURRENT_SCHEMA_VERSION not found in database.ts")
        return
    current = int(match.group(1))
    guards = sorted(int(value) for value in re.findall(r"if\s*\(\s*version\s*===\s*(\d+)\s*\)", text))
    if guards != list(range(0, current)):
        errors.append(
            f"schema ladder: migration guards must be contiguous 0..{current - 1} to match "
            f"CURRENT_SCHEMA_VERSION={current}, found {guards}"
        )
    if decision.is_file():
        documented = {int(value) for value in re.findall(r"\|\s*v(\d+)\s*\|", decision.read_text(encoding="utf-8"))}
        missing = [version for version in range(1, current + 1) if version not in documented]
        if missing:
            errors.append(f"schema ladder: decision 0011 allocation table missing rows for versions {missing}")
    else:
        errors.append("schema ladder: decision 0011 not found for allocation-table check")


def check_links_and_dates(path: Path, errors: list[str]) -> None:
    """Markdown link resolution and a non-future last_verified date (RepoPact does
    not check either)."""
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT)
    if path.name != "AGENTS.md":
        match = LAST_VERIFIED.search(text)
        if match:
            try:
                if date.fromisoformat(match.group(1)) > date.today():
                    errors.append(f"future last_verified date: {rel}")
            except ValueError:
                errors.append(f"invalid last_verified date: {rel}")
    for target in LINK.findall(text):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        clean = target.split("#", 1)[0]
        if clean and not (path.parent / clean).resolve().exists():
            errors.append(f"broken link in {rel}: {target}")


def main() -> int:
    errors: list[str] = []

    run_repopact(errors)

    for item in iter_work_items():
        check_checkbox_parity(item, errors)
    check_schema_ladder(errors)

    markdown_files: list[Path] = []
    for base in ("work", "decisions", "docs"):
        markdown_files.extend((ROOT / base).rglob("*.md"))
    for path in sorted(set(markdown_files)):
        check_links_and_dates(path, errors)

    if errors:
        print("ForgeLink audit failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("ForgeLink audit passed.")
    print("- RepoPact governance validation (scripts/validate_repo.py): passed")
    print("- README/manifest checkbox parity (LIE-001): passed")
    print("- Schema-ladder invariants (LIE-003): passed")
    print("- Markdown link/last_verified checks: passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
