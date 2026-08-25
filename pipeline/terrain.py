"""DEM acquisition, reprojection, clipping, and Cesium ion upload."""

from __future__ import annotations

import subprocess
from pathlib import Path

from . import gdal_tools
from .config import AOI


def download(aoi: AOI) -> list[Path]:
    """Fetch source DEM tiles for the AOI bbox.

    US: 3DEP via the S3 staged-products bucket, no credentials.
    NZ: LINZ Data Service export API, needs LINZ_API_KEY.

    Falls back to aoi.elevation.fallback where the high-res source has gaps.
    """
    raise NotImplementedError(f"download() for source '{aoi.elevation.source}'")


def build(aoi: AOI, tifs: list[Path]) -> Path:
    """Mosaic, reproject to Web Mercator, clip to bbox."""
    out = aoi.data_dir / "terrain"
    out.mkdir(parents=True, exist_ok=True)

    vrt = out / "aoi.vrt"
    warped = out / "aoi_3857.tif"
    clipped = out / "aoi_clip.tif"

    subprocess.run([gdal_tools.require("gdalbuildvrt"), str(vrt), *map(str, tifs)], check=True)
    subprocess.run(
        [gdal_tools.require("gdalwarp"), "-t_srs", "EPSG:3857", "-r", "cubic",
         "-co", "COMPRESS=DEFLATE", str(vrt), str(warped)],
        check=True,
    )
    ulx, uly, lrx, lry = aoi.bbox.as_gdal_projwin()
    subprocess.run(
        [gdal_tools.require("gdal_translate"), "-projwin_srs", "EPSG:4326",
         "-projwin", str(ulx), str(uly), str(lrx), str(lry),
         str(warped), str(clipped)],
        check=True,
    )
    return clipped


def upload_to_ion(clipped: Path, name: str) -> int:
    """Upload as 3D Terrain, return the asset ID. Needs ION_TOKEN."""
    raise NotImplementedError("ion upload")


def ctb_fallback(clipped: Path, out_dir: Path) -> Path:
    """Self-hosted quantized-mesh via cesium-terrain-builder."""
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["docker", "run", "-v", f"{clipped.parent}:/data",
         "tumgis/ctb-quantized-mesh",
         "ctb-tile", "-f", "Mesh", "-C", "-N",
         "-o", "/data/terrain", f"/data/{clipped.name}"],
        check=True,
    )
    return out_dir
