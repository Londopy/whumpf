"""avalanche.org v2 adapter for US forecast centres.

    GET /v2/public/products?center_id=SAC
    GET /v2/public/product?type=forecast&center_id=SAC&zone_id=<id>

No API key. Shape inferred from the documented API -- diff against a live
payload before trusting it.
"""

from __future__ import annotations

import requests

from .base import BulletinAdapter, register
from .schema import Bulletin, Problem

BASE = "https://api.avalanche.org/v2/public"
TIMEOUT = 10

_OCTANT_FROM_ROSE = {
    "n": "N", "ne": "NE", "e": "E", "se": "SE",
    "s": "S", "sw": "SW", "w": "W", "nw": "NW",
}
_BAND_FROM_ROSE = {
    "upper": "upper", "alpine": "upper",
    "middle": "middle", "treeline": "middle",
    "lower": "lower", "btl": "lower",
}


def _parse_rose(rose: list[str]) -> tuple[list[str], list[str]]:
    """['n_upper', 'ne_middle'] -> (['N', 'NE'], ['upper', 'middle']).

    Flattening a 2D rose into two 1D sets is lossy for disjoint roses (N-upper
    plus S-lower becomes N/S x upper/lower). Centres rarely publish those, and
    the loss over-selects terrain rather than under-selecting.
    """
    aspects: list[str] = []
    bands: list[str] = []
    for entry in rose or []:
        parts = str(entry).lower().split("_", 1)
        if len(parts) != 2:
            continue
        a, b = parts
        if (asp := _OCTANT_FROM_ROSE.get(a)) and asp not in aspects:
            aspects.append(asp)
        if (band := _BAND_FROM_ROSE.get(b)) and band not in bands:
            bands.append(band)
    return aspects, bands


@register("avalanche_org")
class AvalancheOrgAdapter(BulletinAdapter):

    def fetch_raw(self) -> dict:
        if not self.cfg.zone_id:
            raise ValueError(
                f"{self.aoi.slug}: bulletin.zone_id is empty. "
                f"GET {BASE}/products?center_id={self.cfg.center_id} to find it."
            )
        r = requests.get(
            f"{BASE}/product",
            params={
                "type": "forecast",
                "center_id": self.cfg.center_id,
                "zone_id": self.cfg.zone_id,
            },
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()

    def normalize(self, raw: dict) -> Bulletin:
        ratings = raw.get("danger", []) or []
        by_band = {str(d.get("valid_day", "")).lower(): d for d in ratings}
        today = by_band.get("current", ratings[0] if ratings else {})

        problems = []
        for p in raw.get("forecast_avalanche_problems", []) or []:
            aspects, bands = _parse_rose(p.get("location", []))
            if not aspects or not bands:
                continue  # unusable rose, skip rather than guess
            problems.append(
                self.resolve_bands(
                    Problem(
                        type=p.get("name", "Unknown"),
                        likelihood=p.get("likelihood", "Unknown"),
                        size=(
                            float(p.get("size", [1, 2])[0]),
                            float(p.get("size", [1, 2])[-1]),
                        ),
                        aspects=aspects,
                        elevations=bands,
                        comment=p.get("discussion", "") or "",
                    )
                )
            )

        return Bulletin(
            source=self._source(
                center=self.cfg.center_id,
                name=raw.get("avalanche_center", {}).get("name", self.cfg.center_id),
                url=raw.get("avalanche_center", {}).get("url", "https://avalanche.org"),
            ),
            danger=self._danger(
                upper=int(today.get("upper", 0) or 0),
                middle=int(today.get("middle", 0) or 0),
                lower=int(today.get("lower", 0) or 0),
            ),
            problems=problems,
            issued=raw.get("published_time", ""),
            expires=raw.get("expires_time", ""),
            aoi=self.aoi.slug,
        )
