"""WHUMPF API: bulletin proxy plus route analysis. No database.

    flask --app api.app run --debug
"""

from __future__ import annotations

import time

from flask import Flask, jsonify, request
from flask_cors import CORS

from api.bulletin import get_adapter
from pipeline.config import all_aoi_slugs, load_aoi

CACHE_TTL = 30 * 60
_cache: dict[str, tuple[float, dict]] = {}


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "aois": all_aoi_slugs()})

    @app.get("/api/aois")
    def aois():
        out = []
        for slug in all_aoi_slugs():
            a = load_aoi(slug)
            out.append({
                "slug": a.slug,
                "name": a.name,
                "country": a.country,
                "hemisphere": a.hemisphere,
                "bbox": a.bbox.as_list(),
                "ion_asset_id": a.elevation.ion_asset_id,
                "bands": {k: list(v) for k, v in a.bulletin.bands.items()},
                "live": not a.bulletin.use_fixture,
            })
        return jsonify(out)

    @app.get("/api/bulletin")
    def bulletin():
        slug = request.args.get("aoi", "castle-peak")
        now = time.time()

        if slug in _cache and now - _cache[slug][0] < CACHE_TTL:
            return jsonify(_cache[slug][1])

        try:
            aoi = load_aoi(slug)
        except FileNotFoundError as e:
            return jsonify({"error": str(e)}), 404

        payload = get_adapter(aoi).get().to_dict()
        _cache[slug] = (now, payload)
        return jsonify(payload)

    @app.post("/api/route/analyze")
    def analyze_route():
        """Sample terrain along a polyline and flag segments matching the problem.

        Expected response:
            {
              "total_m": 3200,
              "flagged_m": 240,
              "segments": [{"start_idx": 12, "end_idx": 19, "length_m": 240}],
              "profile": [{"dist_m": 0, "elev_m": 2100, "slope": 18, "flagged": false}]
            }
        """
        body = request.get_json(silent=True) or {}
        coords = body.get("coordinates", [])
        if len(coords) < 2:
            return jsonify({"error": "need at least 2 coordinates"}), 400
        return jsonify({"error": "not implemented", "received_points": len(coords)}), 501

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
