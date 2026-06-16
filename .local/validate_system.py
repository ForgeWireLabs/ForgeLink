"""Validate the local AGENTS/docs/audit/todo operating layer."""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "AGENTS.md",
    "docs/AGENTS.md",
    "docs/README.md",
    "docs/architecture.md",
    "docs/development.md",
    "docs/operations.md",
    "docs/_audit/README.md",
    "docs/_audit/inventory.md",
    "docs/_audit/alignment-report.md",
    "docs/_audit/security-checklist.md",
    "todos/README.md",
    "todos/001-production-readiness/AGENTS.md",
    "todos/001-production-readiness/README.md",
    "todos/001-production-readiness/_audit/README.md",
    "todos/001-production-readiness/_audit/inventory.md",
    "todos/001-production-readiness/_audit/alignment-report.md",
]
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
DATE = re.compile(r"^last_verified:\s*(\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)


def main() -> int:
    errors: list[str] = []
    markdown_files: list[Path] = []

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
        audit = agents.parent / "_audit"
        if not audit.is_dir():
            errors.append(f"AGENTS scope lacks _audit directory: {agents.relative_to(ROOT)}")

    for path in markdown_files:
        text = path.read_text(encoding="utf-8")
        if path.name != "AGENTS.md" and path.parent != ROOT / "todos":
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

    todo = (ROOT / "todos/001-production-readiness/README.md").read_text(encoding="utf-8")
    ids = re.findall(r"\*\*(PR-\d{3}[A-Z]?)\b", todo)
    if len(ids) != len(set(ids)):
        errors.append("duplicate work-item IDs in todo 001")
    if len(ids) < 18:
        errors.append("todo 001 work-item inventory is unexpectedly incomplete")

    if errors:
        print("Local system audit failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Local system audit passed: {len(REQUIRED)} required files, {len(ids)} work items.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
