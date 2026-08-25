#!/usr/bin/env python3
"""Cut a release: move [Unreleased] into a dated version and sync versions.

The manual step everyone forgets on release day is moving the changelog's
[Unreleased] block into a dated release. patchnotes does that properly --
it refuses to release an empty section or a duplicate version, keeps an
empty [Unreleased] on top, and updates the compare-link footnotes.

This wraps it and also syncs the version into pyproject.toml and
web/package.json, because CI fails if those drift from the tag.

    python scripts/release.py 0.3.0
    python scripts/release.py 0.3.0 --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = REPO_ROOT / "CHANGELOG.md"
PYPROJECT = REPO_ROOT / "pyproject.toml"
WEB_PKG = REPO_ROOT / "web" / "package.json"

REPO_URL = "https://github.com/Londopy/whumpf"
SEMVER = re.compile(r"^\d+\.\d+\.\d+([-+].+)?$")


def bump_changelog(version: str, dry_run: bool) -> None:
    import patchnotes

    cl = patchnotes.parse_file(str(CHANGELOG))

    unreleased = cl.unreleased()
    if unreleased is None or not unreleased.entries:
        sys.exit(
            "CHANGELOG.md has no [Unreleased] entries. "
            "Nothing to release -- write the entry first."
        )

    if cl.get_version(version) is not None:
        sys.exit(f"CHANGELOG.md already has a {version} entry.")

    print(f"Moving {len(unreleased.entries)} entrie(s) into {version}:")
    for entry in unreleased.entries:
        print(f"  [{entry.change_type}] {entry.text}")

    cl.bump(version)
    rendered = patchnotes.to_markdown(cl, repo_url=REPO_URL)
    if dry_run:
        print("\n(dry run) CHANGELOG.md unchanged")
        return
    CHANGELOG.write_text(rendered)
    print(f"\nCHANGELOG.md updated -> {version}")


def sync_versions(version: str, dry_run: bool) -> None:
    py = PYPROJECT.read_text()
    py_new = re.sub(r'^version = "[^"]+"', f'version = "{version}"', py, count=1, flags=re.M)

    pkg = json.loads(WEB_PKG.read_text())
    pkg_old = pkg.get("version")
    pkg["version"] = version

    print(f"pyproject.toml   -> {version}")
    print(f"web/package.json -> {version} (was {pkg_old})")

    if dry_run:
        print("(dry run) version files unchanged")
        return
    PYPROJECT.write_text(py_new)
    WEB_PKG.write_text(json.dumps(pkg, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("version", help="new version, e.g. 0.3.0")
    ap.add_argument("--dry-run", action="store_true", help="show what would change")
    args = ap.parse_args()

    version = args.version.lstrip("v")
    if not SEMVER.match(version):
        sys.exit(f"'{version}' is not a semantic version (expected e.g. 0.3.0)")

    bump_changelog(version, args.dry_run)
    sync_versions(version, args.dry_run)

    if args.dry_run:
        return 0

    print(
        f"\nNext:\n"
        f"  git add -A && git commit -m 'release: {version}'\n"
        f"  git tag v{version}\n"
        f"  git push && git push --tags\n"
        f"\nThe tag triggers .github/workflows/release.yml, which re-runs every\n"
        f"check and builds the GitHub Release body from this changelog entry."
    )
    subprocess.run(["git", "--no-pager", "diff", "--stat"], cwd=REPO_ROOT, check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
