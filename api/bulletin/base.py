"""Adapter base class and registry. One adapter per national bulletin format."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path

from pipeline.config import AOI

from .schema import Bulletin, Danger, Problem, Source

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_REGISTRY: dict[str, type["BulletinAdapter"]] = {}


def register(name: str):
    def deco(cls):
        _REGISTRY[name] = cls
        return cls
    return deco


def get_adapter(aoi: AOI) -> "BulletinAdapter":
    name = aoi.bulletin.adapter
    if name not in _REGISTRY:
        raise KeyError(f"no adapter '{name}'; registered: {sorted(_REGISTRY)}")
    return _REGISTRY[name](aoi)


class BulletinAdapter(ABC):

    def __init__(self, aoi: AOI) -> None:
        self.aoi = aoi
        self.cfg = aoi.bulletin

    @abstractmethod
    def fetch_raw(self) -> dict:
        """Hit the upstream API. Raise on failure; get() falls back."""

    @abstractmethod
    def normalize(self, raw: dict) -> Bulletin:
        """Upstream payload -> Bulletin. Call resolve_bands() on every Problem."""

    def get(self) -> Bulletin:
        if self.cfg.use_fixture:
            return self.load_fixture()
        try:
            return self.normalize(self.fetch_raw())
        except Exception as exc:  # noqa: BLE001
            print(f"[bulletin] {self.aoi.slug}: upstream failed ({exc}); using fixture")
            return self.load_fixture()

    def load_fixture(self) -> Bulletin:
        path = REPO_ROOT / self.cfg.fixture
        if not path.exists():
            raise FileNotFoundError(f"fixture missing: {path}")
        with path.open() as fh:
            raw = json.load(fh)
        b = self.normalize(raw)
        b.is_fixture = True
        return b

    def resolve_bands(self, problem: Problem) -> Problem:
        """Named bands -> metre range, using this AOI's breakpoints.

        Breakpoints are set per-zone by the forecast centre against local
        treeline. They are not shared between AOIs.
        """
        lo, hi = self.cfg.elevation_range(problem.elevations)
        problem.elev_min_m = lo
        problem.elev_max_m = hi
        return problem

    @staticmethod
    def _danger(upper: int = 0, middle: int = 0, lower: int = 0) -> Danger:
        return Danger(upper=upper, middle=middle, lower=lower)

    @staticmethod
    def _source(center: str, name: str, url: str) -> Source:
        return Source(center=center, name=name, url=url)
