"""Normalized terrain features: ski runs, lifts, and trails.

Output is GeoJSON, and the property names are deliberately the ones
OpenSkiMap's vector tiles use ("difficulty", "color", "name_and_type",
"status"). The web client's parseSkiRunProperties/parseSkiLiftProperties
were written against those tiles; matching the names means the client-side
parsers work unchanged whether the data arrives from here or from
OpenSkiMap directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Canonical OSM piste:difficulty values. "unknown" is ours, for when the tag
# is absent -- never invent a difficulty that isn't tagged.
VALID_DIFFICULTIES = (
    "novice",
    "easy",
    "intermediate",
    "advanced",
    "expert",
    "freeride",
    "extreme",
    "other",
    "unknown",
)

# OpenSkiMap pre-computes a colour per difficulty in its tiles. We generate
# from raw OSM, so we compute our own -- this is the conventional European
# piste palette, not OpenSkiMap's exact values. Kept here so the client
# never has to guess and the two sources look consistent on screen.
DIFFICULTY_COLORS = {
    "novice": "#4ade80",
    "easy": "#3b82f6",
    "intermediate": "#ef4444",
    "advanced": "#111827",
    "expert": "#111827",
    "freeride": "#f59e0b",
    "extreme": "#7c3aed",
    "other": "#6b7280",
    "unknown": "#6b7280",
}

LIFT_COLOR = "#a1a1aa"
TRAIL_COLOR = "#22c55e"

FeatureKind = str  # "runs" | "lifts" | "trails"
VALID_KINDS = ("runs", "lifts", "trails")


@dataclass
class Feature:
    """One GeoJSON LineString feature."""

    id: str
    kind: FeatureKind
    # [[lng, lat], ...] -- GeoJSON axis order, not lat/lng.
    coordinates: list[list[float]]
    properties: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "LineString", "coordinates": self.coordinates},
            "properties": {"id": self.id, "kind": self.kind, **self.properties},
        }


@dataclass
class FeatureCollection:
    aoi: str
    features: list[Feature]
    source: str
    attribution: str
    is_fixture: bool = False

    def of_kind(self, kind: FeatureKind) -> list[Feature]:
        return [f for f in self.features if f.kind == kind]

    def to_dict(self, kinds: tuple[FeatureKind, ...] | None = None) -> dict:
        selected = (
            self.features
            if kinds is None
            else [f for f in self.features if f.kind in kinds]
        )
        counts: dict[str, int] = {}
        for f in selected:
            counts[f.kind] = counts.get(f.kind, 0) + 1
        return {
            "type": "FeatureCollection",
            "aoi": self.aoi,
            "source": self.source,
            "attribution": self.attribution,
            "is_fixture": self.is_fixture,
            "counts": counts,
            "features": [f.to_dict() for f in selected],
        }


def normalize_difficulty(value: str | None) -> str:
    return value if value in VALID_DIFFICULTIES else "unknown"


def parse_kinds(raw: str | None) -> tuple[FeatureKind, ...]:
    """Parses a comma-separated ?kinds= parameter.

    Empty/absent means all kinds. Unknown names raise, rather than being
    silently dropped -- a typo returning an empty collection looks exactly
    like "this AOI has no ski runs", which is a miserable thing to debug.
    """
    if not raw:
        return VALID_KINDS
    requested = tuple(k.strip() for k in raw.split(",") if k.strip())
    if not requested:
        return VALID_KINDS
    unknown = [k for k in requested if k not in VALID_KINDS]
    if unknown:
        raise ValueError(
            f"unknown kind(s): {', '.join(unknown)}. Valid: {', '.join(VALID_KINDS)}"
        )
    return requested
