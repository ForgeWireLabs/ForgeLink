"""Validate the local AGENTS/work-ledger operating layer."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from shutil import which
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

REQUIRED = [
    "AGENTS.md",
    "work/README.md",
    "work/active/011-production-readiness/AGENTS.md",
    "work/active/011-production-readiness/README.md",
    "work/active/011-production-readiness/work-item.json",
    "work/active/011-production-readiness/_audit/README.md",
    "work/active/011-production-readiness/_audit/inventory.md",
    "work/active/011-production-readiness/_audit/alignment-report.md",
]

LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
DATE = re.compile(r"^last_verified:\s*(\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)
WORK_DIRS = {
    "active": "active",
    "completed": "completed",
    "deferred": "deferred",
}
VALID_ITEM_STATUS = {"active", "blocked", "completed", "deferred"}
VALID_CRITERION_STATES = {"pending", "satisfied", "waived"}
STALE_WORK_README_PATTERNS = [
    "012-communication-channels",
    "013-agent-human-governance",
    "014-operator-cockpit",
]
OBSOLETE_CRITERION_STATE_LINES = {"in_progress", "completed", "deferred", "rejected"}


def _find_rg() -> str | None:
    local_tool_root = ROOT / ".local" / "tools" / "ripgrep"
    candidates = [
        ROOT / "node_modules" / ".bin" / "rg.cmd",
        ROOT / "node_modules" / ".bin" / "rg.exe",
        ROOT / "node_modules" / ".bin" / "rg",
        local_tool_root / "node_modules" / ".bin" / "rg.cmd",
        local_tool_root / "node_modules" / ".bin" / "rg.exe",
        local_tool_root / "node_modules" / ".bin" / "rg",
        local_tool_root / "node_modules" / "@vscode" / "ripgrep" / "bin" / "rg.exe",
        local_tool_root / "node_modules" / "@vscode" / "ripgrep" / "bin" / "rg",
        ROOT / ".local" / "bin" / "rg.exe",
        ROOT / ".local" / "bin" / "rg",
        ROOT / "tools" / "rg.exe",
        ROOT / "tools" / "rg",
    ]

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    if local_tool_root.exists():
        for pattern in ("rg.exe", "rg.cmd", "rg"):
            matches = sorted(local_tool_root.rglob(pattern))
            for match in matches:
                if match.is_file():
                    return str(match)

    return which("rg")


def _install_rg(errors: list[str]) -> str | None:
    """Install ripgrep into a repo-local tool prefix if it is missing."""

    npm = which("npm.cmd") or which("npm")
    if not npm:
        errors.append("rg is missing and npm is not available to install repo-local ripgrep")
        return None

    prefix = ROOT / ".local" / "tools" / "ripgrep"
    prefix.mkdir(parents=True, exist_ok=True)

    print("rg not found; installing repo-local ripgrep under .local/tools/ripgrep ...")
    result = subprocess.run(
        [
            npm,
            "--prefix",
            str(prefix),
            "install",
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "@vscode/ripgrep",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    if result.returncode != 0:
        errors.append(
            "failed to install repo-local ripgrep with npm: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
        return None

    rg = _find_rg()
    if not rg:
        print("repo-local ripgrep install completed, but rg executable was not found; continuing with Python scan.")
        return None

    return rg


def _check_stale_work_readme(errors: list[str]) -> None:
    readme = ROOT / "work" / "README.md"
    if not readme.is_file():
        errors.append("missing required file: work/README.md")
        return

    rg = _find_rg() or _install_rg(errors)
    pattern = "|".join(re.escape(item) for item in STALE_WORK_README_PATTERNS)
    text = readme.read_text(encoding="utf-8")

    if rg and pattern:
        result = subprocess.run(
            [rg, "--line-number", "--ignore-case", pattern, str(readme)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                errors.append(f"stale work README reference: {line}")
        elif result.returncode not in {1}:
            errors.append(f"rg stale-reference check failed: {result.stderr.strip() or result.stdout.strip()}")
    else:
        for line_number, line in enumerate(text.splitlines(), start=1):
            lowered = line.lower()
            for stale in STALE_WORK_README_PATTERNS:
                if stale.lower() in lowered:
                    errors.append(f"stale work README reference: {readme}:{line_number}:{line}")
                    break

    in_allowed_states_block = False
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        lowered = stripped.lower()
        if "allowed criterion states" in lowered:
            in_allowed_states_block = True
            continue
        if in_allowed_states_block and stripped.startswith("```"):
            continue
        if in_allowed_states_block and stripped.startswith("## "):
            in_allowed_states_block = False
        if in_allowed_states_block and lowered in OBSOLETE_CRITERION_STATE_LINES:
            errors.append(f"obsolete criterion state in work README: {readme}:{line_number}:{line}")


def _load_json(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"invalid json in {path.relative_to(ROOT)}: {exc}")
        return None

    if not isinstance(data, dict):
        errors.append(f"json root must be an object: {path.relative_to(ROOT)}")
        return None

    return data


def _validate_links(path: Path, errors: list[str]) -> None:
    text = path.read_text(encoding="utf-8")

    if path.name != "AGENTS.md":
        match = DATE.search(text)
        if match:
            try:
                verified = date.fromisoformat(match.group(1))
                if verified > date.today():
                    errors.append(f"future last_verified date: {path.relative_to(ROOT)}")
            except ValueError:
                errors.append(f"invalid last_verified date: {path.relative_to(ROOT)}")

    for target in LINK.findall(text):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        clean = target.split("#", 1)[0]
        if clean and not (path.parent / clean).resolve().exists():
            errors.append(f"broken link in {path.relative_to(ROOT)}: {target}")


def _validate_work_item(item_dir: Path, lifecycle: str, errors: list[str]) -> None:
    relative_dir = item_dir.relative_to(ROOT)
    name = item_dir.name

    match = re.match(r"^(\d{3,})-[a-z0-9]+(?:-[a-z0-9]+)*$", name)
    if not match:
        errors.append(f"invalid work item directory name: {relative_dir}")
        return

    expected_id = match.group(1)
    readme = item_dir / "README.md"
    manifest = item_dir / "work-item.json"

    if not readme.is_file():
        errors.append(f"missing work item README: {relative_dir}/README.md")

    if not manifest.is_file():
        errors.append(f"missing work item manifest: {relative_dir}/work-item.json")
        return

    data = _load_json(manifest, errors)
    if data is None:
        return

    actual_id = data.get("id")
    if actual_id != expected_id:
        errors.append(
            f"work item id mismatch in {manifest.relative_to(ROOT)}: "
            f"expected {expected_id}, got {actual_id!r}"
        )

    status = data.get("status")
    if status not in VALID_ITEM_STATUS:
        errors.append(f"invalid work item status in {manifest.relative_to(ROOT)}: {status!r}")

    if lifecycle in {"active", "completed", "deferred"} and status != WORK_DIRS[lifecycle]:
        errors.append(
            f"work item status does not match directory in {manifest.relative_to(ROOT)}: "
            f"directory={lifecycle}, status={status!r}"
        )

    if int(expected_id) >= 10:
        preflight = data.get("preflight")
        if not isinstance(preflight, dict):
            errors.append(f"missing preflight marker in {manifest.relative_to(ROOT)}")
        else:
            if preflight.get("created_before_work_started") is not True:
                errors.append(f"invalid preflight created_before_work_started in {manifest.relative_to(ROOT)}")
            if not preflight.get("created_at"):
                errors.append(f"missing preflight created_at in {manifest.relative_to(ROOT)}")
            if not preflight.get("note"):
                errors.append(f"missing preflight note in {manifest.relative_to(ROOT)}")

    criteria = data.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria:
        errors.append(f"missing acceptance criteria in {manifest.relative_to(ROOT)}")
        return

    criterion_ids: list[str] = []
    for criterion in criteria:
        if not isinstance(criterion, dict):
            errors.append(f"criterion must be object in {manifest.relative_to(ROOT)}")
            continue
        criterion_id = criterion.get("id")
        criterion_ids.append(str(criterion_id))
        state = criterion.get("state")
        if state not in VALID_CRITERION_STATES:
            errors.append(
                f"invalid criterion state in {manifest.relative_to(ROOT)} "
                f"for {criterion_id!r}: {state!r}"
            )
        evidence = criterion.get("evidence")
        if not isinstance(evidence, list):
            errors.append(
                f"criterion evidence must be an array in {manifest.relative_to(ROOT)} "
                f"for {criterion_id!r}"
            )
        if state == "satisfied" and not evidence:
            errors.append(
                f"satisfied criterion lacks evidence in {manifest.relative_to(ROOT)} "
                f"for {criterion_id!r}"
            )

    if len(criterion_ids) != len(set(criterion_ids)):
        errors.append(f"duplicate acceptance criterion IDs in {manifest.relative_to(ROOT)}")

    _validate_readme_parity(readme, relative_dir, criteria, errors)


CHECKBOX = re.compile(r"-\s*\[([ xX])\]\s*\*\*([A-Z]+-\d+)\b")
EVIDENCE_LOG_HEADING = re.compile(r"^#+\s*Evidence log\b", re.IGNORECASE | re.MULTILINE)


def _validate_readme_parity(
    readme: Path, relative_dir: Path, criteria: list[Any], errors: list[str]
) -> None:
    """README must not contradict work-item.json.

    LIE-001: where a README uses the ``- [ ] **ID** ...`` checklist convention,
    every manifest criterion must have a checkbox whose state matches the manifest
    (satisfied -> [x], pending -> [ ]).
    LIE-002: where a README maintains an "Evidence log" section, every satisfied
    criterion's evidence id must appear in it, so "satisfied" is always traceable.

    Both checks are gated on the convention being present so legacy/minimal READMEs
    that defer to work-item.json are not forced to restructure.
    """

    if not readme.is_file():
        return

    text = readme.read_text(encoding="utf-8")
    boxes = {match.group(2): match.group(1).strip().lower() for match in CHECKBOX.finditer(text)}

    # LIE-001: checkbox parity (only for READMEs that use the checklist convention).
    if boxes:
        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue
            criterion_id = str(criterion.get("id"))
            state = criterion.get("state")
            box = boxes.get(criterion_id)
            if box is None:
                errors.append(f"criterion {criterion_id} has no README checkbox: {relative_dir}/README.md")
                continue
            if state == "satisfied" and box != "x":
                errors.append(f"criterion {criterion_id} is satisfied but its README checkbox is unchecked: {relative_dir}/README.md")
            elif state == "pending" and box == "x":
                errors.append(f"criterion {criterion_id} is pending but its README checkbox is checked: {relative_dir}/README.md")

    # LIE-002: evidence cross-reference (only where an Evidence log section exists).
    if EVIDENCE_LOG_HEADING.search(text):
        for criterion in criteria:
            if not isinstance(criterion, dict) or criterion.get("state") != "satisfied":
                continue
            for evidence_id in criterion.get("evidence", []) or []:
                if evidence_id and str(evidence_id) not in text:
                    errors.append(
                        f"satisfied criterion {criterion.get('id')} evidence id not in README evidence log: "
                        f"{evidence_id} ({relative_dir}/README.md)"
                    )


def _check_schema_ladder(errors: list[str]) -> None:
    """Enforce the decision 0011 schema-migration invariants (LIE-003).

    The migration ladder in database.ts is a single contiguous sequence, and every
    shipped version is owned in the decision 0011 allocation table. This catches a
    skipped number, a CURRENT_SCHEMA_VERSION that does not match the last step, or a
    forgotten allocation row.
    """

    database = ROOT / "Electron" / "backend" / "src" / "database.ts"
    decision = ROOT / "decisions" / "0011-schema-migration-coordination.md"
    if not database.is_file():
        return  # No runtime to enforce against; skip rather than fail.

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


def main() -> int:
    errors: list[str] = []
    markdown_files: list[Path] = []

    _check_stale_work_readme(errors)
    _check_schema_ladder(errors)

    for relative in REQUIRED:
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"missing required file: {relative}")
        elif path.suffix == ".md":
            markdown_files.append(path)

    for agents in ROOT.rglob("AGENTS.md"):
        if ".git" in agents.parts:
            continue
        if agents == ROOT / "AGENTS.md":
            continue
        # Some repository scopes require a colocated _audit directory, but work
        # item _audit folders are optional ledger artifacts. Enforce this only
        # for docs scopes when that layer exists.
        if "docs" in agents.parts:
            audit = agents.parent / "_audit"
            if not audit.is_dir():
                errors.append(f"AGENTS scope lacks _audit directory: {agents.relative_to(ROOT)}")

    for path in markdown_files:
        _validate_links(path, errors)

    work_root = ROOT / "work"
    for lifecycle in WORK_DIRS:
        lifecycle_dir = work_root / lifecycle
        if not lifecycle_dir.exists():
            continue
        for item_dir in lifecycle_dir.iterdir():
            if item_dir.is_dir():
                _validate_work_item(item_dir, lifecycle, errors)

    if errors:
        print("Local system audit failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    work_counts: dict[str, int] = {}
    criterion_counts = {"pending": 0, "satisfied": 0, "waived": 0}
    active_items: list[str] = []

    for lifecycle in WORK_DIRS:
        lifecycle_dir = work_root / lifecycle
        if not lifecycle_dir.exists():
            work_counts[lifecycle] = 0
            continue

        item_dirs = [item for item in lifecycle_dir.iterdir() if item.is_dir()]
        work_counts[lifecycle] = len(item_dirs)

        for item_dir in item_dirs:
            manifest = item_dir / "work-item.json"
            if not manifest.is_file():
                continue

            data = json.loads(manifest.read_text(encoding="utf-8"))

            if lifecycle == "active":
                active_items.append(f"{data.get('id')} {data.get('title')}")

            for criterion in data.get("acceptance_criteria", []):
                state = criterion.get("state")
                if state in criterion_counts:
                    criterion_counts[state] += 1

    total_work_items = sum(work_counts.values())

    print("Local system audit passed.")
    print(f"- Required files checked: {len(REQUIRED)}")
    print(f"- Work items checked: {total_work_items}")
    print(
        "- Work item lifecycle counts: "
        f"active={work_counts.get('active', 0)}, "
        f"completed={work_counts.get('completed', 0)}, "
        f"deferred={work_counts.get('deferred', 0)}"
    )
    print(
        "- Acceptance criteria: "
        f"pending={criterion_counts['pending']}, "
        f"satisfied={criterion_counts['satisfied']}, "
        f"waived={criterion_counts['waived']}"
    )

    if active_items:
        print("- Active work:")
        for item in active_items:
            print(f"  - {item}")

    print("- Stale README checks: passed")
    print("- Work item manifest checks: passed")
    print("- README/manifest parity checks: passed")
    print("- Schema-ladder checks: passed")
    print("- Markdown link/date checks: passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
