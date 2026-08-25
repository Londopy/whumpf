"""Pack slope/aspect/elevation into RGBA rasters for shader-side filtering.

Channels:
    R  slope     0-90 deg    0.353 deg/step
    G  aspect    0-360 deg   1.412 deg/step
    B  elevation 0-4000 m    15.686 m/step
    A  validity  0 or 255

PNG only, nearest-neighbour. JPEG corrupts the packed values.
The B channel is too coarse for runout; that loads a separate f32 DEM.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from . import gdal_tools

SLOPE_MAX = 90.0
ASPECT_MAX = 360.0
ELEV_MAX = 4000.0

SLOPE_SCALE = 255.0 / SLOPE_MAX
ASPECT_SCALE = 255.0 / ASPECT_MAX
ELEV_SCALE = 255.0 / ELEV_MAX

SLOPE_STEP = SLOPE_MAX / 255.0
ASPECT_STEP = ASPECT_MAX / 255.0
ELEV_STEP = ELEV_MAX / 255.0

OCTANT_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def pack(
    slope_deg: np.ndarray,
    aspect_deg: np.ndarray,
    elev_m: np.ndarray,
    valid: np.ndarray | None = None,
) -> np.ndarray:
    """Three float arrays -> uint8 (H, W, 4). Out-of-range values are clipped."""
    if not (slope_deg.shape == aspect_deg.shape == elev_m.shape):
        raise ValueError(
            f"shape mismatch: slope={slope_deg.shape} "
            f"aspect={aspect_deg.shape} elev={elev_m.shape}"
        )

    if valid is None:
        valid = np.ones(slope_deg.shape, dtype=bool)

    # gdaldem emits -9999 for flat cells; clamp to 0 before the modulo so it
    # doesn't wrap onto a real bearing.
    aspect = np.mod(np.where(aspect_deg < 0, 0.0, aspect_deg), ASPECT_MAX)

    h, w = slope_deg.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., 0] = np.round(np.clip(slope_deg, 0, SLOPE_MAX) * SLOPE_SCALE).astype(np.uint8)
    out[..., 1] = np.round(aspect * ASPECT_SCALE).astype(np.uint8)
    out[..., 2] = np.round(np.clip(elev_m, 0, ELEV_MAX) * ELEV_SCALE).astype(np.uint8)
    out[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    return out


def unpack(rgba: np.ndarray) -> dict[str, np.ndarray]:
    """Inverse of pack(). Must stay in sync with the fragment shader."""
    if rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError(f"expected (H, W, 4), got {rgba.shape}")

    return {
        "slope_deg": rgba[..., 0].astype(np.float32) / SLOPE_SCALE,
        "aspect_deg": rgba[..., 1].astype(np.float32) / ASPECT_SCALE,
        "elev_m": rgba[..., 2].astype(np.float32) / ELEV_SCALE,
        "valid": rgba[..., 3] > 0,
    }


def aspect_to_octant(aspect_deg: np.ndarray | float) -> np.ndarray | int:
    """Bearing -> octant index 0-7. The +22.5 offset centres N on 0/360."""
    return (np.floor((np.asarray(aspect_deg) + 22.5) / 45.0).astype(int)) % 8


def aspects_to_bitmask(aspects: list[str]) -> int:
    """["N", "NE"] -> 0b00000011."""
    mask = 0
    for a in aspects:
        key = a.strip().upper()
        if key not in OCTANT_NAMES:
            raise ValueError(f"unknown aspect '{a}'; expected one of {OCTANT_NAMES}")
        mask |= 1 << OCTANT_NAMES.index(key)
    return mask


def run_gdaldem(dem_path: Path, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    slope_path = out_dir / "slope.tif"
    aspect_path = out_dir / "aspect.tif"

    subprocess.run(
        [gdal_tools.require("gdaldem"), "slope", str(dem_path), str(slope_path),
         "-compute_edges"],
        check=True,
    )
    subprocess.run(
        [gdal_tools.require("gdaldem"), "aspect", str(dem_path), str(aspect_path),
         "-compute_edges", "-zero_for_flat"],
        check=True,
    )
    return slope_path, aspect_path


def build_attribute_raster(dem_path: Path, out_dir: Path) -> Path:
    """DEM -> slope/aspect -> packed RGBA GeoTIFF."""
    import rasterio  # lazy: tests run without GDAL bindings

    slope_path, aspect_path = run_gdaldem(dem_path, out_dir)

    with rasterio.open(dem_path) as dem_src:
        elev = dem_src.read(1).astype(np.float32)
        profile = dem_src.profile
        nodata = dem_src.nodata

    with rasterio.open(slope_path) as s:
        slope = s.read(1).astype(np.float32)
    with rasterio.open(aspect_path) as a:
        aspect = a.read(1).astype(np.float32)

    valid = np.isfinite(elev)
    if nodata is not None:
        valid &= elev != nodata
    valid &= slope > -1000

    rgba = pack(slope, aspect, elev, valid)

    out_path = out_dir / "attributes.tif"
    profile.update(dtype="uint8", count=4, nodata=None, compress="deflate", photometric="rgb")
    with rasterio.open(out_path, "w", **profile) as dst:
        for i in range(4):
            dst.write(rgba[..., i], i + 1)

    _verify_round_trip(out_path, slope_path)
    return out_path


def _verify_round_trip(packed_path: Path, slope_path: Path) -> None:
    """Sample one pixel and confirm it unpacks to what gdaldem reported."""
    import rasterio

    with rasterio.open(packed_path) as p, rasterio.open(slope_path) as s:
        row, col = p.height // 2, p.width // 2
        rgba = np.stack([p.read(i + 1)[row, col] for i in range(4)])
        expected = float(s.read(1)[row, col])

    got = float(unpack(rgba.reshape(1, 1, 4))["slope_deg"][0, 0])

    if abs(got - expected) > SLOPE_STEP:
        raise AssertionError(
            f"round-trip failed at ({row},{col}): gdaldem={expected:.3f} "
            f"unpacked={got:.3f} tol={SLOPE_STEP:.3f}"
        )
    print(f"  round-trip OK at ({row},{col}): slope {expected:.2f} deg")


def tile(packed_path: Path, out_dir: Path, zoom: tuple[int, int]) -> Path:
    tiles_dir = out_dir / "attr"
    subprocess.run(
        [gdal_tools.require("gdal2tiles"), "-p", "mercator", "-z", f"{zoom[0]}-{zoom[1]}",
         "-r", "near", "--xyz", str(packed_path), str(tiles_dir)],
        check=True,
    )
    return tiles_dir
