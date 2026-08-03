import pytest

from api.bulletin.avalanche_org import _parse_rose
from api.bulletin.schema import VALID_ASPECTS, Bulletin, Danger, Problem, Source
from pipeline.attributes import aspects_to_bitmask
from pipeline.config import load_aoi


def test_aspect_mask_matches_pipeline_encoding():
    # schema and pipeline must agree or the shader gets a mask that means
    # something different from what the tiles encode.
    for aspects in (["N"], ["S", "SE"], ["N", "NE", "E"], VALID_ASPECTS):
        p = Problem("Slab", "Likely", (1, 3), aspects, ["upper"])
        assert p.aspect_mask == aspects_to_bitmask(aspects)


def test_problem_rejects_bad_aspect():
    with pytest.raises(ValueError, match="invalid aspects"):
        Problem("Slab", "Likely", (1, 3), ["NNE"], ["upper"])


def test_problem_rejects_bad_band():
    with pytest.raises(ValueError, match="invalid bands"):
        Problem("Slab", "Likely", (1, 3), ["N"], ["alpine"])


def test_danger_max_and_label():
    assert Danger(upper=3, middle=2, lower=1).max == 3
    assert Danger(upper=3, middle=2, lower=1).label == "Considerable"
    assert Danger(upper=4, middle=4, lower=2).color == "#EE1C25"


def test_expired_bulletin_is_stale():
    b = Bulletin(
        source=Source("SAC", "Sierra", "https://x"),
        danger=Danger(3, 3, 2),
        problems=[],
        issued="2026-02-14T06:00:00+00:00",
        expires="2026-02-15T06:00:00+00:00",
        aoi="castle-peak",
    )
    assert b.is_stale


def test_unparseable_expiry_is_stale():
    assert Bulletin(Source("X", "X", "x"), Danger(), [], "", "garbage", "x").is_stale


def test_bands_resolve_from_aoi_config():
    aoi = load_aoi("castle-peak")
    assert aoi.bulletin.elevation_range(["upper"]) == (2590.0, 4000.0)


def test_contiguous_bands_union():
    aoi = load_aoi("castle-peak")
    assert aoi.bulletin.elevation_range(["middle", "upper"]) == (2130.0, 4000.0)


def test_band_breakpoints_differ_between_aois():
    us = load_aoi("castle-peak").bulletin.elevation_range(["upper"])
    nz = load_aoi("craigieburn").bulletin.elevation_range(["upper"])
    assert us[0] != nz[0]


def test_empty_bands_do_not_select_everything():
    assert load_aoi("castle-peak").bulletin.elevation_range([]) == (0.0, 0.0)


def test_band_for_elevation():
    b = load_aoi("castle-peak").bulletin
    assert b.band_for_elevation(1000) == "lower"
    assert b.band_for_elevation(2300) == "middle"
    assert b.band_for_elevation(3000) == "upper"


def test_parse_rose():
    aspects, bands = _parse_rose(["n_upper", "ne_upper", "e_middle"])
    assert aspects == ["N", "NE", "E"]
    assert bands == ["upper", "middle"]


def test_parse_rose_ignores_malformed_entries():
    aspects, bands = _parse_rose(["n_upper", "garbage", "", "zz_upper"])
    assert aspects == ["N"]
    assert bands == ["upper"]


def test_parse_rose_empty():
    assert _parse_rose([]) == ([], [])
    assert _parse_rose(None) == ([], [])


def test_southern_hemisphere_problem_round_trips():
    aoi = load_aoi("craigieburn")
    assert aoi.is_southern
    p = Problem("Wind Slab", "Likely", (1, 2), ["S", "SE", "E"], ["upper", "middle"])
    assert p.aspect_mask == aspects_to_bitmask(["S", "SE", "E"])
    assert aoi.bulletin.elevation_range(p.elevations) == (1100.0, 2400.0)
