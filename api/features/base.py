"""Feature adapter base and registry. Mirrors api/bulletin/base.py.

Same shape as the bulletin adapters on purpose: one adapter per upstream
source, a registry keyed by name, and a fixture fallback so the API still
answers when the network is down or an upstream is rate-limiting. If you
have read the bulletin adapters, you have read these.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path

from pipeline.config import AOI

from .schema import FeatureCollection

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_REGISTRY: dict[str, type["FeatureAdapter"]] = {}


def register(name: str):
    def deco(cls):
        _REGISTRY[name] = cls
        return cls

    return deco


def get_adapter(aoi: AOI, name: str | None = None) -> "FeatureAdapter":
    """Returns the feature adapter for an AOI.

    Unlike bulletins, terrain features have no per-AOI adapter choice in the
    TOML yet -- OSM covers everywhere. The name argument exists so a future
    AOI can override (a resort's own published run data, say) without
    changing call sites.
    """
    key = name or aoi.raw.get("features", {}).get("adapter", "overpass")
    if key not in _REGISTRY:
        raise KeyError(f"no feature adapter '{key}'; registered: {sorted(_REGISTRY)}")
    return _REGISTRY[key](aoi)


class FeatureAdapter(ABC):
    def __init__(self, aoi: AOI) -> None:
        self.aoi = aoi
        self.cfg = aoi.raw.get("features", {})

    @abstractmethod
    def fetch_raw(self) -> dict:
        """Hit the upstream API. Raise on failure; get() falls back."""

    @abstractmethod
    def normalize(self, raw: dict) -> FeatureCollection:
        """Upstream payload -> FeatureCollection."""

    @property
    def fixture_path(self) -> Path:
        configured = self.cfg.get("fixture")
        if configured:
            return REPO_ROOT / configured
        return REPO_ROOT / "api" / "fixtures" / f"{self.aoi.slug}-features.json"

    def get(self) -> FeatureCollection:
        if self.cfg.get("use_fixture"):
            return self.load_fixture()
        try:
            return self.normalize(self.fetch_raw())
        except Exception as exc:  # noqa: BLE001
            print(f"[features] {self.aoi.slug}: upstream failed ({exc}); using fixture")
            return self.load_fixture()

    def load_fixture(self) -> FeatureCollection:
        path = self.fixture_path
        if not path.exists():
            # An AOI with no fixture and no network is not an error -- it is
            # an AOI with no features yet. Returning empty keeps the client
            # rendering the mountain instead of showing a failure banner for
            # something optional.
            return FeatureCollection(
                aoi=self.aoi.slug,
                features=[],
                source="none",
                attribution="",
                is_fixture=True,
            )
        with path.open() as fh:
            raw = json.load(fh)
        collection = self.normalize(raw)
        collection.is_fixture = True
        return collection
