#!/usr/bin/env python3
"""Capture a real /api/aoi/<slug>/features response for the TS contract test.

The contract test (web/test/contract.ts) asserts that the TypeScript client
parsers work on what the Python endpoint actually sends. It runs against a
captured payload rather than a live server, which means the capture can go
stale: the endpoint changes, nobody re-runs this, and the test keeps passing
against a payload the server no longer produces. CI regenerates and diffs to
catch exactly that.

    python scripts/capture_features_response.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from api.app import create_app  # noqa: E402
from api.features.overpass import OverpassFeatureAdapter  # noqa: E402

OUT = REPO_ROOT / "web" / "test" / "fixtures-endpoint-response.json"
AOI = "craigieburn"


def main() -> int:
    # Force the fixture path. Capturing from live Overpass would make the
    # committed payload change whenever someone edits OSM, which would turn
    # the freshness check into noise.
    def offline(self):
        raise RuntimeError("capture runs against the fixture, not the network")

    OverpassFeatureAdapter.fetch_raw = offline  # type: ignore[method-assign]

    app = create_app()
    app.config.update(TESTING=True)
    client = app.test_client()

    response = client.get(f"/api/aoi/{AOI}/features")
    if response.status_code != 200:
        print(f"unexpected status {response.status_code}", file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(response.get_json(), indent=2) + "\n")
    body = response.get_json()
    print(f"captured {len(body['features'])} features -> {OUT.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
