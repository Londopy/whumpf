"""Pipeline CLI.

    python -m pipeline.cli check
    python -m pipeline.cli terrain    --aoi castle-peak
    python -m pipeline.cli terrain    --aoi castle-peak --dem ~/Downloads/USGS_1m.tif
    python -m pipeline.cli attributes --aoi castle-peak
    python -m pipeline.cli imagery    --aoi castle-peak
    python -m pipeline.cli all        --aoi castle-peak

Each stage is independently re-runnable and writes to data/<slug>/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import attributes, gdal_tools, imagery, terrain
from .config import all_aoi_slugs, load_aoi


def cmd_check(_args) -> int:
    ok = True
    print("GDAL tools:")
    # Resolved the same way the pipeline resolves them, so a green check
    # means the subprocess calls will actually work -- not just that
    # something with a matching name sits on PATH.
    for tool in gdal_tools.TOOL_CANDIDATES:
        path = gdal_tools.find(tool)
        print(f"  {'OK  ' if path else 'MISS'} {tool}" + (f"  ({path})" if path else ""))
        ok &= path is not None

    print("\nPython packages:")
    for mod in ["numpy", "rasterio", "pystac_client", "flask"]:
        try:
            __import__(mod)
            print(f"  OK   {mod}")
        except ImportError:
            print(f"  MISS {mod}")
            ok = False

    print("\nAOIs:")
    for slug in all_aoi_slugs():
        a = load_aoi(slug)
        ion = a.elevation.ion_asset_id or "(not uploaded)"
        live = "LIVE" if not a.bulletin.use_fixture else "fixture"
        print(f"  {slug:16} {a.hemisphere}  ion={ion}  bulletin={live}")

    return 0 if ok else 1


def cmd_terrain(args) -> int:
    """DEM -> warp -> clip, and optionally upload the mesh to Cesium ion.

    `--dem` takes GeoTIFFs you already have, skipping download() -- which is
    still a stub, and which you do not need. Grab a DEM by hand (3DEP via
    apps.nationalmap.gov, LINZ via data.linz.govt.nz) and point this at it.

    ion upload is skipped unless you ask for it. The terrain *mesh* and the
    attribute *overlay* are independent: Cesium World Terrain is a perfectly
    good base while the overlay becomes real, and the overlay is the part
    that carries the actual information. ion only buys mesh resolution.
    """
    aoi = load_aoi(args.aoi)

    if args.dem:
        tifs = [Path(p).expanduser() for p in args.dem]
        missing = [str(t) for t in tifs if not t.exists()]
        if missing:
            print(f"no such file: {', '.join(missing)}", file=sys.stderr)
            return 1
        print(f"using {len(tifs)} supplied DEM file(s)")
    else:
        tifs = terrain.download(aoi)

    clipped = terrain.build(aoi, tifs)
    print(f"clipped DEM -> {clipped}")

    if not args.upload_ion:
        print("\nSkipped ion upload (pass --upload-ion to do it).")
        print(f"Next: python -m pipeline.cli attributes --aoi {aoi.slug}")
        return 0

    asset_id = terrain.upload_to_ion(clipped, aoi.name)
    print(f"\nion asset id: {asset_id}")
    print(f"-> set elevation.ion_asset_id = {asset_id} in config/aoi/{aoi.slug}.toml")
    return 0


def cmd_attributes(args) -> int:
    aoi = load_aoi(args.aoi)
    dem = aoi.data_dir / "terrain" / "aoi_clip.tif"
    if not dem.exists():
        print(f"missing {dem} -- run 'terrain' first", file=sys.stderr)
        return 1
    packed = attributes.build_attribute_raster(dem, aoi.data_dir / "attributes")
    out = attributes.tile(packed, aoi.data_dir, aoi.tiles.attribute_zoom)
    print(f"attribute tiles -> {out}")
    print(
        f"\nServe them locally with the API running, then set\n"
        f"  VITE_ATTRIBUTE_TILES=/api/tiles/{aoi.slug}/attributes\n"
        f"in web/.env to replace the synthetic test tile."
    )
    return 0


def cmd_imagery(args) -> int:
    aoi = load_aoi(args.aoi)
    scenes = imagery.search_scenes(aoi)
    print(f"{len(scenes)} candidate scenes")
    raise NotImplementedError("wire mask -> correct -> composite -> stretch -> tile")


def cmd_all(args) -> int:
    for fn in (cmd_terrain, cmd_attributes, cmd_imagery):
        if (rc := fn(args)) != 0:
            return rc
    return 0


def main() -> int:
    p = argparse.ArgumentParser(prog="whumpf")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="verify toolchain and config").set_defaults(fn=cmd_check)

    for name, fn, helptext in [
        ("terrain", cmd_terrain, "download DEM, warp, clip, upload to ion"),
        ("attributes", cmd_attributes, "slope/aspect/elev -> packed RGBA -> PNG tiles"),
        ("imagery", cmd_imagery, "STAC -> mask -> topo correct -> composite -> tiles"),
        ("all", cmd_all, "run every stage"),
    ]:
        sp = sub.add_parser(name, help=helptext)
        sp.add_argument("--aoi", required=True, choices=all_aoi_slugs())
        if name in ("terrain", "all"):
            sp.add_argument(
                "--dem", nargs="+", metavar="TIF",
                help="use these GeoTIFFs instead of downloading (download() is a stub)",
            )
            sp.add_argument(
                "--upload-ion", action="store_true",
                help="also upload the mesh to Cesium ion (not needed for the overlay)",
            )
        sp.set_defaults(fn=fn)

    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
