"""AOI configuration loader."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # py3.10
    import tomli as tomllib  # type: ignore[no-redef]

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "config" / "aoi"
DATA_DIR = REPO_ROOT / "data"


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def as_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]

    def as_gdal_projwin(self) -> tuple[float, float, float, float]:
        """gdal_translate -projwin order: ulx uly lrx lry."""
        return (self.west, self.north, self.east, self.south)


@dataclass(frozen=True)
class ElevationConfig:
    source: str
    fallback: str
    ion_asset_id: int = 0
    s3_prefix: str = ""
    layer_id: str = ""


@dataclass(frozen=True)
class ImageryConfig:
    collection: str
    season_months: list[int]
    years: list[int]
    max_cloud_cover: int
    detail_collection: str = ""


@dataclass(frozen=True)
class BulletinConfig:
    adapter: str
    center_id: str
    fixture: str
    use_fixture: bool
    bands: dict[str, tuple[float, float]]
    zone_id: str = ""
    region: str = ""

    def band_for_elevation(self, elev_m: float) -> str | None:
        for name, (lo, hi) in self.bands.items():
            if lo <= elev_m < hi:
                return name
        return None

    def elevation_range(self, band_names: list[str]) -> tuple[float, float]:
        """Collapse named bands to a single metre range for the shader.

        Bands are contiguous, so the union of any subset is min(lows), max(highs).
        """
        if not band_names:
            return (0.0, 0.0)
        lows = [self.bands[b][0] for b in band_names if b in self.bands]
        highs = [self.bands[b][1] for b in band_names if b in self.bands]
        if not lows:
            return (0.0, 0.0)
        return (min(lows), max(highs))


@dataclass(frozen=True)
class TileConfig:
    attribute_zoom: tuple[int, int]
    imagery_zoom: tuple[int, int]


@dataclass(frozen=True)
class AOI:
    slug: str
    name: str
    country: str
    hemisphere: str
    bbox: BBox
    elevation: ElevationConfig
    imagery: ImageryConfig
    bulletin: BulletinConfig
    tiles: TileConfig
    raw: dict = field(default_factory=dict, repr=False)

    @property
    def data_dir(self) -> Path:
        return DATA_DIR / self.slug

    @property
    def is_southern(self) -> bool:
        return self.hemisphere.upper() == "S"


def load_aoi(slug: str) -> AOI:
    path = CONFIG_DIR / f"{slug}.toml"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in CONFIG_DIR.glob("*.toml")))
        raise FileNotFoundError(f"No AOI config '{slug}'. Available: {available}")

    with path.open("rb") as fh:
        d = tomllib.load(fh)

    bands = {k: (float(v[0]), float(v[1])) for k, v in d["bulletin"]["bands"].items()}

    return AOI(
        slug=d["slug"],
        name=d["name"],
        country=d["country"],
        hemisphere=d["hemisphere"],
        bbox=BBox(*d["bbox"]),
        elevation=ElevationConfig(
            source=d["elevation"]["source"],
            fallback=d["elevation"]["fallback"],
            ion_asset_id=d["elevation"].get("ion_asset_id", 0),
            s3_prefix=d["elevation"].get("s3_prefix", ""),
            layer_id=d["elevation"].get("layer_id", ""),
        ),
        imagery=ImageryConfig(
            collection=d["imagery"]["collection"],
            season_months=d["imagery"]["season_months"],
            years=d["imagery"]["years"],
            max_cloud_cover=d["imagery"]["max_cloud_cover"],
            detail_collection=d["imagery"].get("detail_collection", ""),
        ),
        bulletin=BulletinConfig(
            adapter=d["bulletin"]["adapter"],
            center_id=d["bulletin"]["center_id"],
            fixture=d["bulletin"]["fixture"],
            use_fixture=d["bulletin"]["use_fixture"],
            bands=bands,
            zone_id=d["bulletin"].get("zone_id", ""),
            region=d["bulletin"].get("region", ""),
        ),
        tiles=TileConfig(
            attribute_zoom=tuple(d["tiles"]["attribute_zoom"]),
            imagery_zoom=tuple(d["tiles"]["imagery_zoom"]),
        ),
        raw=d,
    )


def all_aoi_slugs() -> list[str]:
    return sorted(p.stem for p in CONFIG_DIR.glob("*.toml"))
