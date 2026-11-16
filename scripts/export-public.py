#!/usr/bin/env python3
"""Export tracked public files into a new directory; never includes Git history."""
import argparse
import json
import re
from pathlib import Path
import subprocess
from urllib.parse import unquote

PRIVATE_FILES = {"TODO.md", "TODO-HANDOFF.md", "SESSION-HANDOFF.md", "DESIGN.md", "docs/ui-review-2026-11-14.txt"}
PRIVATE_PREFIXES = ("docs/internal/", "docs/handoff/")
RUNTIME_PREFIXES = ("storage/", "projects/", "work/", "dist/", "coverage/", "node_modules/", ".next/", ".open-next/", ".wrangler/")


def forbidden_runtime_file(name):
    parts = Path(name).parts
    return (name.startswith(RUNTIME_PREFIXES)
            or any(part.startswith(".env") and part != ".env.example" for part in parts)
            or any(part in {"credentials", ".credentials", ".git"} for part in parts))


def missing_document_links(root, public):
    available = set(public)
    missing = []
    for name in public:
        if not name.endswith(".md"):
            continue
        for target in re.findall(r'\]\(([^)]+)\)', (root / name).read_text()):
            target = target.strip().split(' "')[0].strip("<>")
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith("#"):
                continue
            target = unquote(target.split("#")[0])
            resolved = (root / name).parent.joinpath(target).resolve()
            try:
                relative = str(resolved.relative_to(root.resolve()))
            except ValueError:
                relative = ""
            if target and relative not in available and not any(item.startswith(relative + "/") for item in available if relative):
                missing.append(f"{name}: {target}")
    return missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    destination = args.destination.resolve()
    if destination.exists():
        parser.error("Destination must not exist; existing files are never replaced")
    files = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    public = [name for name in files if name and name not in PRIVATE_FILES and not name.startswith(PRIVATE_PREFIXES)]
    # Validate before creating the export, including tracked-but-deleted files.
    for name in public:
        source = root / name
        if forbidden_runtime_file(name):
            parser.error(f"Runtime or credential file is tracked; refusing export: {name}")
        if source.is_symlink() or not source.is_file():
            parser.error(f"Tracked file is unavailable or a symlink: {name}")
    missing = missing_document_links(root, public)
    if missing:
        parser.error("Public documentation links to excluded or missing files: " + "; ".join(missing))
    destination.mkdir(parents=True)
    for name in public:
        source = root / name
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        target.chmod(source.stat().st_mode & 0o777)
    print(json.dumps({"files": len(public), "historyIncluded": False, "privateDocumentsIncluded": False}))


if __name__ == "__main__":
    main()
