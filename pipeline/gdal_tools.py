"""Locating GDAL command-line tools across platforms.

GDAL ships some of its tools as native executables and others as Python
scripts, and the packaging differs by platform:

    Linux / conda-forge     gdal2tiles.py   (a script, executable, on PATH)
    Windows / conda-forge   gdal2tiles.exe  (a wrapper) alongside
                            gdal2tiles.py   (not directly executable)

`shutil.which("gdal2tiles.py")` finds the Linux one and misses the Windows
one, because Windows only treats an extension as executable if it is in
PATHEXT, and `.py` usually is not. Worse, `subprocess.run(["gdal2tiles.py",
...])` on Windows fails for the same reason -- so this was not a cosmetic
problem with the `check` command, it would have broken tiling for real.

Resolving by a list of candidate names sidesteps all of it without
branching on `sys.platform`, which tends to be wrong on somebody's setup.
"""

from __future__ import annotations

import shutil

# Ordered by preference. The bare name matches the Windows .exe wrapper and
# any distro that installs an extensionless entry point; the .py form is what
# conda-forge and most Linux packages provide.
TOOL_CANDIDATES: dict[str, tuple[str, ...]] = {
    "gdalinfo": ("gdalinfo",),
    "gdalwarp": ("gdalwarp",),
    "gdaldem": ("gdaldem",),
    "gdal_translate": ("gdal_translate",),
    "gdalbuildvrt": ("gdalbuildvrt",),
    "gdal2tiles": ("gdal2tiles", "gdal2tiles.py"),
}


def find(tool: str) -> str | None:
    """Absolute path to `tool`, or None if no candidate is on PATH."""
    for candidate in TOOL_CANDIDATES.get(tool, (tool,)):
        path = shutil.which(candidate)
        if path:
            return path
    return None


def require(tool: str) -> str:
    """Absolute path to `tool`, or raise with something actionable.

    Returns the resolved *path* rather than the name so subprocess invokes
    it directly -- on Windows that is what makes the .exe wrapper work.
    """
    path = find(tool)
    if path:
        return path
    tried = ", ".join(TOOL_CANDIDATES.get(tool, (tool,)))
    raise FileNotFoundError(
        f"{tool} not found on PATH (tried: {tried}). "
        "Install GDAL's command-line tools -- see README.md, Setup."
    )


def missing() -> list[str]:
    """Tools that cannot be resolved. Empty means the toolchain is complete."""
    return [name for name in TOOL_CANDIDATES if find(name) is None]
