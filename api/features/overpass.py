"""OpenStreetMap ski runs, lifts, and trails via the Overpass API.

Why Overpass rather than OpenSkiMap's vector tiles, which is what the
desktop client used: Cesium has no vector-tile pipeline, so the tiles were
unusable anyway. But the deeper reason is that whumpf is AOI-scoped and the
desktop app was world-wide. Fetching one bounding box of features and
serving it as GeoJSON is both simpler than decoding tiles and strictly more
useful -- the client gets real features it can click, filter, and measure,
which a raster overlay could never give it.

Overpass is a free, shared, rate-limited service. Treat it accordingly:
results are meant to be fetched once per AOI and cached (the endpoint does
this), not queried per map movement.
"""

from __future__ import annotations

import requests

from .base import FeatureAdapter, register
from .schema import (
    DIFFICULTY_COLORS,
    LIFT_COLOR,
    TRAIL_COLOR,
    Feature,
    FeatureCollection,
    normalize_difficulty,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
TIMEOUT_S = 90

ATTRIBUTION = (
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" '
    'rel="noreferrer">OpenStreetMap</a> contributors'
)

# Trail highway values worth showing on a ski/alpine map. Deliberately
# excludes footway and pedestrian, which in OSM are overwhelmingly urban
# pavements -- including them buries the actual approach tracks.
TRAIL_HIGHWAYS = ("path", "track", "bridleway")

# Human-readable lift names. OSM tags the machinery; the client's
# parseLiftType reads the type back out of the "Name (Type)" string, so the
# labels here have to be the ones it looks for.
AERIALWAY_LABELS = {
    "gondola": "Gondola",
    "cable_car": "Cable Car",
    "chair_lift": "Chairlift",
    "mixed_lift": "Chairlift",
    "t-bar": "T-bar Drag",
    "j-bar": "J-bar Drag",
    "platter": "Platter Drag",
    "rope_tow": "Drag",
    "drag_lift": "Drag",
    "magic_carpet": "Magic Carpet",
    "zip_line": "Other",
}


def build_query(west: float, south: float, east: float, north: float) -> str:
    """Overpass QL for one bounding box.

    `out geom` returns coordinates inline on each way, so there is no second
    round trip to resolve node references.
    """
    bbox = f"{south},{west},{north},{east}"
    highways = "|".join(TRAIL_HIGHWAYS)
    return f"""[out:json][timeout:{TIMEOUT_S}];
(
  way["piste:type"="downhill"]({bbox});
  way["aerialway"]({bbox});
  way["highway"~"^({highways})$"]({bbox});
);
out geom;
"""


def _coords(element: dict) -> list[list[float]]:
    """Overpass `geometry` is [{lat, lon}, ...]; GeoJSON wants [lng, lat]."""
    geometry = element.get("geometry") or []
    out: list[list[float]] = []
    for node in geometry:
        lat, lon = node.get("lat"), node.get("lon")
        if lat is None or lon is None:
            continue
        out.append([float(lon), float(lat)])
    return out


def _run_feature(element: dict, coords: list[list[float]]) -> Feature:
    tags = element.get("tags", {})
    difficulty = normalize_difficulty(tags.get("piste:difficulty"))
    return Feature(
        id=f"run/{element['id']}",
        kind="runs",
        coordinates=coords,
        properties={
            "name": tags.get("piste:name") or tags.get("name"),
            "difficulty": difficulty,
            "color": DIFFICULTY_COLORS[difficulty],
            "gladed": tags.get("gladed") == "yes",
            "patrolled": tags.get("patrolled"),
        },
    )


def _lift_feature(element: dict, coords: list[list[float]]) -> Feature:
    tags = element.get("tags", {})
    aerialway = tags.get("aerialway", "")
    label = AERIALWAY_LABELS.get(aerialway, "Other")
    name = tags.get("name")
    # The client parses the type back out of this string, so the format is
    # load-bearing, not decorative.
    name_and_type = f"{name} ({label})" if name else label
    return Feature(
        id=f"lift/{element['id']}",
        kind="lifts",
        coordinates=coords,
        properties={
            "name": name,
            "name_and_type": name_and_type,
            "aerialway": aerialway,
            "status": tags.get("aerialway:status") or tags.get("state"),
            "color": LIFT_COLOR,
        },
    )


def _trail_feature(element: dict, coords: list[list[float]]) -> Feature:
    tags = element.get("tags", {})
    return Feature(
        id=f"trail/{element['id']}",
        kind="trails",
        coordinates=coords,
        properties={
            "name": tags.get("name"),
            "highway": tags.get("highway"),
            "sac_scale": tags.get("sac_scale"),
            "color": TRAIL_COLOR,
        },
    )


@register("overpass")
class OverpassFeatureAdapter(FeatureAdapter):
    name = "OpenStreetMap (Overpass)"

    def fetch_raw(self) -> dict:
        query = build_query(*self.aoi.bbox.as_list())
        response = requests.post(
            OVERPASS_URL,
            data={"data": query},
            timeout=TIMEOUT_S,
            headers={"User-Agent": "whumpf/0.2 (+https://github.com/Londopy/whumpf)"},
        )
        response.raise_for_status()
        return response.json()

    def normalize(self, raw: dict) -> FeatureCollection:
        features: list[Feature] = []
        for element in raw.get("elements", []):
            if element.get("type") != "way":
                continue
            coords = _coords(element)
            # A one-node way is not a line. Dropping these here keeps every
            # downstream length/slope calculation from having to defend
            # against degenerate geometry.
            if len(coords) < 2:
                continue

            tags = element.get("tags", {})
            if tags.get("piste:type") == "downhill":
                features.append(_run_feature(element, coords))
            elif tags.get("aerialway"):
                features.append(_lift_feature(element, coords))
            elif tags.get("highway") in TRAIL_HIGHWAYS:
                features.append(_trail_feature(element, coords))

        return FeatureCollection(
            aoi=self.aoi.slug,
            features=features,
            source=self.name,
            attribution=ATTRIBUTION,
        )
