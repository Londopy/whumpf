import json

import pytest

from api.app import create_app
from api.features.overpass import OverpassFeatureAdapter, build_query
from api.features.schema import DIFFICULTY_COLORS, normalize_difficulty, parse_kinds
from pipeline.config import load_aoi

FIXTURE = "api/fixtures/craigieburn-features.json"


@pytest.fixture
def collection():
    aoi = load_aoi("craigieburn")
    adapter = OverpassFeatureAdapter(aoi)
    with open(FIXTURE) as fh:
        raw = json.load(fh)
    return adapter.normalize(raw)


# --- query construction ----------------------------------------------------


def test_overpass_bbox_order_is_south_west_north_east():
    # Overpass takes (south,west,north,east). GeoJSON/our config store
    # (west,south,east,north). Transposing these silently queries the wrong
    # part of the world and returns a plausible-looking empty result.
    q = build_query(171.60, -43.20, 171.85, -43.05)
    assert "(-43.2,171.6,-43.05,171.85)" in q.replace(" ", "")


def test_query_covers_all_three_kinds():
    q = build_query(171.60, -43.20, 171.85, -43.05)
    assert '"piste:type"="downhill"' in q
    assert '"aerialway"' in q
    assert '"highway"' in q


# --- normalization ---------------------------------------------------------


def test_classifies_each_kind(collection):
    assert len(collection.of_kind("runs")) == 2
    assert len(collection.of_kind("lifts")) == 2
    assert len(collection.of_kind("trails")) == 2


def test_drops_degenerate_and_non_way_elements(collection):
    ids = {f.id for f in collection.features}
    # single-node way, urban footway, and a node element
    assert "trail/100007" not in ids
    assert "trail/100008" not in ids
    assert "trail/100009" not in ids
    assert len(collection.features) == 6


def test_coordinates_are_lng_lat_not_lat_lng(collection):
    run = next(f for f in collection.features if f.id == "run/100001")
    lng, lat = run.coordinates[0]
    # Craigieburn is ~171E, ~-43S. If these swap, the feature lands in the
    # Southern Ocean and nothing visibly errors.
    assert 171.0 < lng < 172.0
    assert -44.0 < lat < -43.0


def test_untagged_difficulty_is_unknown_not_invented(collection):
    run = next(f for f in collection.features if f.id == "run/100002")
    assert run.properties["difficulty"] == "unknown"
    assert run.properties["color"] == DIFFICULTY_COLORS["unknown"]


def test_tagged_difficulty_carries_its_colour(collection):
    run = next(f for f in collection.features if f.id == "run/100001")
    assert run.properties["difficulty"] == "advanced"
    assert run.properties["color"] == DIFFICULTY_COLORS["advanced"]


def test_lift_name_and_type_matches_client_parser_format(collection):
    # web/src/providers/SkiDataProvider.ts::parseLiftType reads the type back
    # out of the trailing parenthesis. This format is load-bearing.
    tow = next(f for f in collection.features if f.id == "lift/100003")
    assert tow.properties["name_and_type"] == "Top Tow (T-bar Drag)"
    assert tow.properties["status"] == "operating"


def test_unnamed_lift_still_reports_its_type(collection):
    chair = next(f for f in collection.features if f.id == "lift/100004")
    assert chair.properties["name_and_type"] == "Chairlift"


def test_normalize_difficulty_rejects_unknown_values():
    assert normalize_difficulty("expert") == "expert"
    assert normalize_difficulty("black-diamond") == "unknown"
    assert normalize_difficulty(None) == "unknown"


# --- serialization ---------------------------------------------------------


def test_to_dict_is_valid_geojson(collection):
    d = collection.to_dict()
    assert d["type"] == "FeatureCollection"
    for f in d["features"]:
        assert f["type"] == "Feature"
        assert f["geometry"]["type"] == "LineString"
        assert len(f["geometry"]["coordinates"]) >= 2


def test_to_dict_filters_by_kind(collection):
    d = collection.to_dict(("runs",))
    assert d["counts"] == {"runs": 2}
    assert all(f["properties"]["kind"] == "runs" for f in d["features"])


def test_parse_kinds():
    assert parse_kinds(None) == ("runs", "lifts", "trails")
    assert parse_kinds("") == ("runs", "lifts", "trails")
    assert parse_kinds("runs,lifts") == ("runs", "lifts")
    assert parse_kinds(" runs , trails ") == ("runs", "trails")
    with pytest.raises(ValueError, match="unknown kind"):
        parse_kinds("runs,pistes")


# --- endpoint --------------------------------------------------------------


@pytest.fixture
def client():
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_endpoint_returns_feature_collection(client, monkeypatch):
    # Force the fixture path so the test never touches Overpass.
    monkeypatch.setattr(
        OverpassFeatureAdapter, "fetch_raw", lambda self: (_ for _ in ()).throw(RuntimeError("offline"))
    )
    r = client.get("/api/aoi/craigieburn/features")
    assert r.status_code == 200
    body = r.get_json()
    assert body["type"] == "FeatureCollection"
    assert body["is_fixture"] is True
    assert body["counts"]["runs"] == 2


def test_endpoint_filters_by_kind(client, monkeypatch):
    monkeypatch.setattr(
        OverpassFeatureAdapter, "fetch_raw", lambda self: (_ for _ in ()).throw(RuntimeError("offline"))
    )
    r = client.get("/api/aoi/craigieburn/features?kinds=lifts")
    assert r.status_code == 200
    assert r.get_json()["counts"] == {"lifts": 2}


def test_endpoint_rejects_unknown_kind(client):
    r = client.get("/api/aoi/craigieburn/features?kinds=pistes")
    assert r.status_code == 400
    assert "unknown kind" in r.get_json()["error"]


def test_endpoint_404s_on_unknown_aoi(client):
    r = client.get("/api/aoi/not-a-real-place/features")
    assert r.status_code == 404


def test_aoi_without_fixture_returns_empty_not_error(client, monkeypatch):
    monkeypatch.setattr(
        OverpassFeatureAdapter, "fetch_raw", lambda self: (_ for _ in ()).throw(RuntimeError("offline"))
    )
    r = client.get("/api/aoi/castle-peak/features")
    assert r.status_code == 200
    body = r.get_json()
    assert body["features"] == []
    assert body["counts"] == {}
