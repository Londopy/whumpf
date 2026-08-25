"""Reference slope/aspect, and a cross-check of any library that computes them.

whumpf does not compute slope or aspect itself -- pipeline/attributes.py
shells out to `gdaldem` and only packs the result. That means the numbers the
entire product depends on come from outside the repo, and nothing here has
ever checked them.

This module fixes that. It provides an in-repo Horn (1981) implementation --
the method gdaldem uses -- verified against analytically-known planes, so any
candidate slope/aspect source can be diffed against a reference that lives
with the code.

Why it matters more here than in most projects: whumpf's whole function is
filtering terrain by aspect against a bulletin that says things like "N
through NE, above 2400 m". An aspect convention that is mirrored, rotated, or
off by a sign lights up the wrong side of every mountain, and it does so
plausibly enough that nobody notices.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

CELL_M = 30.0


def horn_slope_aspect(dem: np.ndarray, cell_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Horn (1981) slope and aspect, matching gdaldem's default.

    Raster convention: row 0 is north, column 0 is west.
    Aspect is the downslope direction in degrees, 0 = N, increasing clockwise.
    Flat cells get -9999, the sentinel gdaldem emits and attributes.pack()
    already special-cases.
    """
    z = np.asarray(dem, dtype=float)
    padded = np.pad(z, 1, mode="edge")

    a, b, c = padded[:-2, :-2], padded[:-2, 1:-1], padded[:-2, 2:]
    d, f = padded[1:-1, :-2], padded[1:-1, 2:]
    g, h, i = padded[2:, :-2], padded[2:, 1:-1], padded[2:, 2:]

    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell_m)  # +x = east
    dz_dy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cell_m)  # +y = south

    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))

    # The gradient points uphill; aspect is the downhill bearing. North
    # component of downhill is +dz_dy, east component is -dz_dx.
    aspect = np.degrees(np.arctan2(-dz_dx, dz_dy)) % 360.0
    aspect = np.where((dz_dx == 0) & (dz_dy == 0), -9999.0, aspect)

    return slope, aspect


def tilted_plane(n: int, dz_per_row: float, dz_per_col: float) -> np.ndarray:
    """A planar DEM. Rows increase southward, columns increase eastward."""
    rows = np.arange(n)[:, None]
    cols = np.arange(n)[None, :]
    return (dz_per_row * rows + dz_per_col * cols).astype(float)


def centre(grid: np.ndarray) -> float:
    """Centre cell -- away from the edge-padding, so purely interior maths."""
    arr = np.asarray(grid)
    return float(arr[arr.shape[0] // 2, arr.shape[1] // 2])


def _rise(angle_deg: float) -> float:
    return CELL_M * math.tan(math.radians(angle_deg))


# (label, dz/drow, dz/dcol, expected slope, expected aspect)
PLANE_CASES = [
    ("descends due north", _rise(30), 0.0, 30.0, 0.0),
    ("descends due south", -_rise(30), 0.0, 30.0, 180.0),
    ("descends due east", 0.0, -_rise(20), 20.0, 90.0),
    ("descends due west", 0.0, _rise(20), 20.0, 270.0),
    ("descends north-east", _rise(30), -_rise(30), 39.2315, 45.0),
    ("descends south-west", -_rise(30), _rise(30), 39.2315, 225.0),
    ("steep, descends north", _rise(45), 0.0, 45.0, 0.0),
]


@pytest.mark.parametrize("label,d_row,d_col,exp_slope,exp_aspect", PLANE_CASES)
def test_horn_matches_analytic_planes(label, d_row, d_col, exp_slope, exp_aspect):
    slope, aspect = horn_slope_aspect(tilted_plane(9, d_row, d_col), CELL_M)
    assert centre(slope) == pytest.approx(exp_slope, abs=0.01), label

    got = centre(aspect)
    delta = min(abs(got - exp_aspect), 360.0 - abs(got - exp_aspect))
    assert delta < 0.01, f"{label}: aspect {got:.2f}, expected {exp_aspect:.2f}"


def test_flat_ground_is_sentinel_not_a_bearing():
    """Flat ground has no aspect, and must not be reported as one.

    attributes.pack() clamps -9999 to 0 before the modulo specifically so a
    flat cell does not wrap onto a real bearing. A source that returns, say,
    180 for flat terrain would paint every flat area as south-facing -- which
    is exactly the aspect spring bulletins flag.
    """
    _, aspect = horn_slope_aspect(tilted_plane(9, 0.0, 0.0), CELL_M)
    assert centre(aspect) == -9999.0


def test_aspect_is_the_downhill_bearing_not_the_uphill_one():
    """Guards the sign convention that is easiest to invert and hardest to see."""
    # z rises toward the south, so the ground falls away toward the north.
    _, aspect = horn_slope_aspect(tilted_plane(9, _rise(30), 0.0), CELL_M)
    assert centre(aspect) == pytest.approx(0.0, abs=0.01)


# --- third-party cross-check ------------------------------------------------

pygeospy = pytest.importorskip(
    "pygeospy.terrain",
    reason="pygeospy is an optional cross-check dependency",
)


def test_pygeospy_slope_agrees_with_horn():
    """pygeospy's slope matches Horn exactly, including on diagonals."""
    for label, d_row, d_col, exp_slope, _ in PLANE_CASES:
        dem = tilted_plane(9, d_row, d_col)
        got = centre(pygeospy.slope_aspect(dem.tolist(), cell_size_m=CELL_M)["slope"])
        assert got == pytest.approx(exp_slope, abs=0.01), label


@pytest.mark.xfail(
    reason=(
        "pygeospy 0.2.2 mirrors the aspect east/west axis: north and south are "
        "correct, east and west are swapped, and diagonals land 90 degrees out. "
        "Confirmed against three independent references (Horn, central "
        "differences, brute-force steepest descent), which all agree with each "
        "other. It also returns 180 for flat ground rather than a flat sentinel. "
        "Do not use it as an aspect source for whumpf until fixed; its slope is "
        "sound. Remove this xfail when the upstream fix lands -- the test will "
        "then start failing as XPASS and tell you."
    ),
    strict=True,
)
def test_pygeospy_aspect_agrees_with_horn():
    for label, d_row, d_col, _, exp_aspect in PLANE_CASES:
        dem = tilted_plane(9, d_row, d_col)
        got = centre(pygeospy.slope_aspect(dem.tolist(), cell_size_m=CELL_M)["aspect"])
        delta = min(abs(got - exp_aspect), 360.0 - abs(got - exp_aspect))
        assert delta < 0.01, f"{label}: pygeospy {got:.2f}, Horn {exp_aspect:.2f}"
