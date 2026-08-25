"""Winter Sentinel-2 composite with topographic illumination correction.

Sequence: STAC search -> cloud/shadow mask -> SCS+C correction -> percentile
composite -> percentile stretch -> optional detail blend -> tile.

season_months comes from AOI config; southern AOIs use Sep/Oct.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from . import gdal_tools
from .config import AOI

# Scene Classification Layer classes.
SCL_KEEP = {4, 5, 11}      # vegetation, bare soil, snow/ice
SCL_DROP = {3, 8, 9, 10}   # cloud shadow, cloud med, cloud high, cirrus


def search_scenes(aoi: AOI) -> list:
    """STAC search against Planetary Computer. Expect 15-40 candidates.

    Scene-level eo:cloud_cover is computed over the whole tile and says little
    about a 12x11 km window; mask first, then count valid pixels.
    """
    raise NotImplementedError("pystac-client search")


def mask_scene(scl: np.ndarray) -> np.ndarray:
    return np.isin(scl, list(SCL_KEEP))


def cos_incidence(
    slope_rad: np.ndarray,
    aspect_rad: np.ndarray,
    sun_zenith_rad: float,
    sun_azimuth_rad: float,
) -> np.ndarray:
    """cos(i) = cos(slope)cos(z) + sin(slope)sin(z)cos(azimuth - aspect).

    Sun angles come from MEAN_SOLAR_ZENITH_ANGLE / MEAN_SOLAR_AZIMUTH_ANGLE.
    """
    return (
        np.cos(slope_rad) * np.cos(sun_zenith_rad)
        + np.sin(slope_rad) * np.sin(sun_zenith_rad)
        * np.cos(sun_azimuth_rad - aspect_rad)
    )


def scs_c_correct(
    rho: np.ndarray,
    cos_i: np.ndarray,
    slope_rad: np.ndarray,
    sun_zenith_rad: float,
    valid: np.ndarray | None = None,
) -> np.ndarray:
    """SCS+C correction (Soenen et al. 2005).

    rho_corr = rho * (cos(slope)cos(z) + c) / (cos(i) + c), c = b/m from a
    linear regression of rho on cos(i).
    """
    if valid is None:
        valid = np.isfinite(rho) & np.isfinite(cos_i)

    x = cos_i[valid].ravel()
    y = rho[valid].ravel()
    if x.size < 100:
        return rho

    m, b = np.polyfit(x, y, 1)
    if abs(m) < 1e-9:
        return rho
    c = b / m

    num = np.cos(slope_rad) * np.cos(sun_zenith_rad) + c
    den = cos_i + c
    return np.clip(np.where(np.abs(den) > 1e-6, rho * num / den, rho), 0, None)


def composite(stack: np.ndarray, percentile: float = 60.0) -> np.ndarray:
    """Per-pixel percentile across scenes. Use the median below ~8 scenes."""
    return np.nanpercentile(stack, percentile, axis=0)


def stretch(arr: np.ndarray, lo: float = 2.0, hi: float = 98.0) -> np.ndarray:
    """Percentile clip. Min/max saturates on snow and flattens the terrain."""
    p_lo, p_hi = np.nanpercentile(arr, [lo, hi])
    if p_hi <= p_lo:
        return np.zeros_like(arr, dtype=np.uint8)
    return np.clip((arr - p_lo) / (p_hi - p_lo) * 255, 0, 255).astype(np.uint8)


def detail_blend(composite_rgb: np.ndarray, detail_rgb: np.ndarray) -> np.ndarray:
    """LAB luminance swap: L from the high-res source, a/b from the composite.

    NAIP for US, LINZ aerial for NZ. Optional.
    """
    raise NotImplementedError("LAB blend")


def tile(composite_path: Path, out_dir: Path, zoom: tuple[int, int]) -> Path:
    tiles_dir = out_dir / "imagery"
    subprocess.run(
        [gdal_tools.require("gdal2tiles"), "-p", "mercator", "-z", f"{zoom[0]}-{zoom[1]}",
         "-r", "bilinear", "--xyz", str(composite_path), str(tiles_dir)],
        check=True,
    )
    return tiles_dir
