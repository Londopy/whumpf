"""Normalized bulletin types.

Every national format collapses into this. Aspect roses become bitmasks and
named elevation bands become metre ranges here, on the server, once.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

VALID_ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
VALID_BANDS = ["lower", "middle", "upper"]

DANGER_LABELS = {
    0: "No Rating",
    1: "Low",
    2: "Moderate",
    3: "Considerable",
    4: "High",
    5: "Extreme",
}

DANGER_COLORS = {
    0: "#CCCCCC",
    1: "#53AA48",
    2: "#FFF300",
    3: "#F79218",
    4: "#EE1C25",
    5: "#000000",
}


@dataclass
class Problem:
    type: str
    likelihood: str
    size: tuple[float, float]
    aspects: list[str]
    elevations: list[str]
    slope_min: float = 30.0
    slope_max: float = 50.0
    elev_min_m: float = 0.0
    elev_max_m: float = 4000.0
    comment: str = ""

    def __post_init__(self) -> None:
        bad = [a for a in self.aspects if a not in VALID_ASPECTS]
        if bad:
            raise ValueError(f"invalid aspects {bad}; expected subset of {VALID_ASPECTS}")
        bad = [b for b in self.elevations if b not in VALID_BANDS]
        if bad:
            raise ValueError(f"invalid bands {bad}; expected subset of {VALID_BANDS}")

    @property
    def aspect_mask(self) -> int:
        mask = 0
        for a in self.aspects:
            mask |= 1 << VALID_ASPECTS.index(a)
        return mask


@dataclass
class Danger:
    upper: int = 0
    middle: int = 0
    lower: int = 0

    @property
    def max(self) -> int:
        return max(self.upper, self.middle, self.lower)

    @property
    def label(self) -> str:
        return DANGER_LABELS.get(self.max, "Unknown")

    @property
    def color(self) -> str:
        return DANGER_COLORS.get(self.max, "#CCCCCC")


@dataclass
class Source:
    center: str
    name: str
    url: str


@dataclass
class Bulletin:
    source: Source
    danger: Danger
    problems: list[Problem]
    issued: str
    expires: str
    aoi: str
    is_fixture: bool = False
    fetched_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    @property
    def is_stale(self) -> bool:
        """Fails closed: an unparseable expiry counts as stale."""
        try:
            expires = datetime.fromisoformat(self.expires.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return True
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > expires

    def to_dict(self) -> dict:
        d = asdict(self)
        d["is_stale"] = self.is_stale
        d["danger"]["max"] = self.danger.max
        d["danger"]["label"] = self.danger.label
        d["danger"]["color"] = self.danger.color
        for p, orig in zip(d["problems"], self.problems):
            p["aspect_mask"] = orig.aspect_mask
        return d
