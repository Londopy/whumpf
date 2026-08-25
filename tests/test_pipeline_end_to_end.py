"""Does a slope that physically faces NE end up matching the bulletin's NE bit?

Every existing attribute test checks one link of the chain in isolation:
`pack`/`unpack` round-trips, `aspect_to_octant` boundaries, `aspects_to_bitmask`
bit positions. All pass. None of them answer the question above, which is the
only one that matters when someone is looking at a slope.

The chain is:

    terrain geometry
      -> slope/aspect computation (gdaldem, Horn's method)
      -> pack() into RGBA
      -> unpack() in the shader
      -> aspect_to_octant()
      -> tested against the bulletin's aspect_mask

A sign error, a transposed axis, or a convention mismatch anywhere in there
produces a map that highlights the wrong slopes and looks entirely plausible
doing it. That is not hypothetical: pygeospy 0.2.2 shipped a mirrored aspect
axis through two releases with a passing test on top of it, because the test
asserted one cardinal and a mirror leaves two of them correct.

So these tests assert all eight compass directions, end to end, against
closed-form terrain whose true aspect is known exactly.
"""

from __future__ import annotations

import math
import shutil
import subprocess

import numpy as np
import pytest

from pipeline.attributes import (
    OCTANT_NAMES,
    aspect_to_octant,
    aspects_to_bitmask,
    pack,
    unpack,
)
from tests.test_terrain_reference import CELL_M, horn_slope_aspect, tilted_plane

# (compass name, dz/drow, dz/dcol, true slope)
# Rows increase southward, columns increase eastward. A plane whose elevation
# rises toward the south descends toward the north, so it faces north.
_R = CELL_M * math.tan(math.radians(35))  # 35 deg: squarely in avalanche terrain

FACING = [
    ("N", _R, 0.0),
    ("NE", _R, -_R),
    ("E", 0.0, -_R),
    ("SE", -_R, -_R),
    ("S", -_R, 0.0),
    ("SW", -_R, _R),
    ("W", 0.0, _R),
    ("NW", _R, _R),
]


def _octant_through_the_pipeline(d_row: float, d_col: float) -> int:
    """Runs one planar slope through the real chain and returns its octant.

    Uses the in-repo Horn implementation in place of the `gdaldem` subprocess.
    That substitution is safe because `test_terrain_reference` verifies Horn
    against analytically-known planes, and Horn is the method gdaldem uses --
    but see `test_real_gdaldem_agrees` below, which runs the actual binary
    when it is installed.
    """
    dem = tilted_plane(9, d_row, d_col)
    slope, aspect = horn_slope_aspect(dem, CELL_M)

    # Elevation is irrelevant to aspect; give it something in range.
    elev = np.full_like(slope, 2000.0)

    packed = pack(slope, aspect, elev)
    recovered = unpack(packed)

    centre = (slope.shape[0] // 2, slope.shape[1] // 2)
    return int(np.asarray(aspect_to_octant(recovered["aspect_deg"]))[centre])


@pytest.mark.parametrize("name,d_row,d_col", FACING)
def test_slope_facing_a_direction_lands_in_that_octant(name, d_row, d_col):
    """The whole point. A NE-facing slope must read as NE, not SW."""
    octant = _octant_through_the_pipeline(d_row, d_col)
    assert OCTANT_NAMES[octant] == name, (
        f"a slope physically facing {name} came out as {OCTANT_NAMES[octant]}"
    )


@pytest.mark.parametrize("name,d_row,d_col", FACING)
def test_bulletin_mask_lights_the_matching_slope(name, d_row, d_col):
    """A bulletin naming an aspect must select the slope facing that way.

    This is the shader's actual test -- `(u_aspectMask >> octant) & 1` -- run
    against real geometry rather than against a hand-written octant index.
    """
    octant = _octant_through_the_pipeline(d_row, d_col)
    mask = aspects_to_bitmask([name])
    assert (mask >> octant) & 1, f"bulletin for {name} did not select a {name} slope"


@pytest.mark.parametrize("name,d_row,d_col", FACING)
def test_bulletin_mask_excludes_the_opposite_slope(name, d_row, d_col):
    """And must NOT select the slope facing the other way.

    A mirrored axis passes the previous test for north and south while
    silently inverting east and west. Asserting the negative case is what
    catches that.
    """
    octant = _octant_through_the_pipeline(d_row, d_col)
    opposite = OCTANT_NAMES[(OCTANT_NAMES.index(name) + 4) % 8]
    mask = aspects_to_bitmask([opposite])
    assert not ((mask >> octant) & 1), (
        f"bulletin for {opposite} wrongly selected a {name} slope"
    )


def test_a_realistic_bulletin_selects_exactly_its_aspects():
    """'N through NE' must light N and NE, and nothing else."""
    mask = aspects_to_bitmask(["N", "NE"])
    selected = {
        name for name, d_row, d_col in FACING
        if (mask >> _octant_through_the_pipeline(d_row, d_col)) & 1
    }
    assert selected == {"N", "NE"}


def test_flat_ground_is_excluded_by_slope_not_by_aspect():
    """Flat ground reads as due north, and only the slope filter hides it.

    `run_gdaldem` passes `-zero_for_flat`, so flat cells come back as aspect
    0 -- a real bearing, indistinguishable from genuinely north-facing. In
    bulletin mode that is harmless because the same bulletin carries a slope
    minimum (typically 30 degrees) which flat ground fails.

    It is worth knowing that the protection comes from the slope filter and
    not the aspect filter: in manual mode, dropping the slope minimum to zero
    with N selected will paint every flat area. That is a UI consideration,
    not a data bug, but it is exactly the kind of thing that looks like a
    finding when you first see it on the map.
    """
    flat = tilted_plane(9, 0.0, 0.0)
    slope, aspect = horn_slope_aspect(flat, CELL_M)

    # horn_slope_aspect uses gdaldem's -9999 sentinel; pack() clamps it, and
    # -zero_for_flat would have produced 0 directly. Both land on north.
    packed = pack(slope, aspect, np.full_like(slope, 2000.0))
    recovered = unpack(packed)
    centre = (slope.shape[0] // 2, slope.shape[1] // 2)

    assert OCTANT_NAMES[int(np.asarray(aspect_to_octant(recovered["aspect_deg"]))[centre])] == "N"
    # ...but the slope is zero, so any realistic bulletin minimum excludes it.
    assert recovered["slope_deg"][centre] < 1.0


# --- the real binary, when it is available --------------------------------


def _has_gdal() -> bool:
    return shutil.which("gdaldem") is not None


@pytest.mark.skipif(not _has_gdal(), reason="gdaldem not installed")
@pytest.mark.parametrize("name,d_row,d_col", FACING)
def test_real_gdaldem_agrees(name, d_row, d_col, tmp_path):
    """Runs the actual gdaldem binary, not the in-repo Horn stand-in.

    Everything above substitutes Horn for the subprocess. This closes that
    last gap on any machine with GDAL installed -- which is every machine
    that can run the pipeline at all, and CI.
    """
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    dem = tilted_plane(9, d_row, d_col).astype(np.float32)

    dem_path = tmp_path / "dem.tif"
    with rasterio.open(
        dem_path, "w", driver="GTiff", height=dem.shape[0], width=dem.shape[1],
        count=1, dtype="float32", crs="EPSG:3857",
        transform=from_origin(0, 0, CELL_M, CELL_M),
    ) as dst:
        dst.write(dem, 1)

    aspect_path = tmp_path / "aspect.tif"
    subprocess.run(
        ["gdaldem", "aspect", str(dem_path), str(aspect_path),
         "-compute_edges", "-zero_for_flat"],
        check=True, capture_output=True,
    )

    with rasterio.open(aspect_path) as src:
        aspect = src.read(1)

    centre = (aspect.shape[0] // 2, aspect.shape[1] // 2)
    octant = int(np.asarray(aspect_to_octant(aspect))[centre])
    assert OCTANT_NAMES[octant] == name, (
        f"gdaldem put a {name}-facing slope in {OCTANT_NAMES[octant]} "
        f"(raw aspect {aspect[centre]:.1f} deg)"
    )


# --- GDAL tool resolution --------------------------------------------------


def test_gdal_tool_resolution_handles_both_packagings(tmp_path, monkeypatch):
    """gdal2tiles is a .py on Linux and an .exe wrapper on Windows.

    `shutil.which("gdal2tiles.py")` finds the first and misses the second,
    and `subprocess.run(["gdal2tiles.py", ...])` outright fails on Windows
    because `.py` is not in PATHEXT. That made this a real tiling failure,
    not just a cosmetic problem with `cli check`.
    """
    import os
    import stat

    from pipeline import gdal_tools

    def fake_tool(name: str) -> None:
        path = tmp_path / name
        path.write_text("#!/bin/sh\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)

    # Linux/conda-forge packaging.
    fake_tool("gdal2tiles.py")
    monkeypatch.setenv("PATH", str(tmp_path), prepend=os.pathsep)
    assert gdal_tools.find("gdal2tiles") is not None

    # Windows packaging: the .exe wrapper, no directly-runnable .py.
    (tmp_path / "gdal2tiles.py").unlink()
    fake_tool("gdal2tiles")
    assert gdal_tools.find("gdal2tiles") is not None


def test_missing_gdal_tool_says_what_to_do(tmp_path, monkeypatch):
    """The error names every candidate tried, not just the one that failed."""
    from pipeline import gdal_tools

    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(FileNotFoundError, match="tried: gdal2tiles, gdal2tiles.py"):
        gdal_tools.require("gdal2tiles")


def test_check_and_pipeline_resolve_tools_identically():
    """`cli check` must not go green on something the pipeline cannot run.

    Both go through gdal_tools.find, so a passing check is a real guarantee
    rather than a name that happens to sit on PATH.
    """
    from pipeline import cli, gdal_tools

    assert "shutil" not in cli.__dict__, "cli should resolve via gdal_tools, not shutil.which"
    assert set(gdal_tools.missing()) <= set(gdal_tools.TOOL_CANDIDATES)
