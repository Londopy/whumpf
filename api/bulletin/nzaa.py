"""New Zealand Avalanche Advisory adapter.

Stub. The NZAA payload shape is unverified -- find the JSON endpoint behind
avalanche.net.nz, capture a real response into api/fixtures/nzaa-sample.json,
and rewrite normalize() against it.

Open questions: endpoint URL and auth, region identifiers, whether danger is
numeric or labelled, rose representation, band names, timestamp timezone
(NZST/NZDT, not UTC).
"""

from __future__ import annotations

from .base import BulletinAdapter, register
from .schema import Bulletin, Problem

BASE = "https://api.avalanche.net.nz"  # unverified
TIMEOUT = 10

_DANGER_FROM_LABEL = {
    "no rating": 0,
    "low": 1,
    "moderate": 2,
    "considerable": 3,
    "high": 4,
    "extreme": 5,
}


def _danger_value(v) -> int:
    """Accepts either an integer or a label."""
    if isinstance(v, (int, float)):
        return int(v)
    return _DANGER_FROM_LABEL.get(str(v).strip().lower(), 0)


@register("nzaa")
class NZAAAdapter(BulletinAdapter):

    def fetch_raw(self) -> dict:
        raise NotImplementedError(
            "NZAA endpoint not identified yet; set use_fixture = true in "
            "config/aoi/craigieburn.toml until it is"
        )

    def normalize(self, raw: dict) -> Bulletin:
        # Reads the already-normalized fixture shape so the API works end to end
        # before the real adapter lands. Rewrite once the payload is known.
        problems = []
        for p in raw.get("problems", []) or []:
            problems.append(
                self.resolve_bands(
                    Problem(
                        type=p.get("type", "Unknown"),
                        likelihood=p.get("likelihood", "Unknown"),
                        size=tuple(p.get("size", (1, 2))),
                        aspects=p.get("aspects", []),
                        elevations=p.get("elevations", []),
                        slope_min=float(p.get("slope_min", 30)),
                        slope_max=float(p.get("slope_max", 50)),
                        comment=p.get("comment", ""),
                    )
                )
            )

        d = raw.get("danger", {}) or {}
        return Bulletin(
            source=self._source(
                center="NZAA",
                name="New Zealand Avalanche Advisory",
                url="https://www.avalanche.net.nz/",
            ),
            danger=self._danger(
                upper=_danger_value(d.get("upper", 0)),
                middle=_danger_value(d.get("middle", 0)),
                lower=_danger_value(d.get("lower", 0)),
            ),
            problems=problems,
            issued=raw.get("issued", ""),
            expires=raw.get("expires", ""),
            aoi=self.aoi.slug,
        )
