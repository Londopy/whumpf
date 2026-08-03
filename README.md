# WHUMPF

**Avalanche bulletins, projected onto the actual mountain in 3D.**

A *whumpf* is the sound a weak layer makes when it collapses under you and the fracture
propagates outward. It is the most unambiguous signal in avalanche safety: if you hear it,
the snowpack is telling you it will fail. This is an attempt to give you that signal
*before* you are standing on the slope.

---

## The problem

A published avalanche bulletin reads something like:

> Persistent slab. N through NE aspects. Above 2400 m. 30–45 degrees.
> Danger: **CONSIDERABLE (3)**.

That is accurate, and it is not an answer to the question you are actually asking, which is:
**is the slope in front of me one of those slopes?**

WHUMPF filters the terrain by the bulletin's own parameters and lights up every slope that
matches. Rotate the mountain, see which bowls are loaded, see whether your skin track
crosses one.

## Status

Pre-build. See [`whumpf-spec-v0.2.md`](./whumpf-spec-v0.2.md) for the full technical spec.

## Safety notice

WHUMPF **displays** official avalanche bulletins published by regional forecast centres.
It does not generate, interpolate, modify, or supplement any forecast. The overlay is a
visualisation of a published product, not a recommendation, and not a substitute for
avalanche education, appropriate equipment, current observations, or your own judgement.
Always consult the source bulletin. Terrain data contains errors.

---

## Architecture

Almost everything is static files. The backend is deliberately thin: two bulletin adapters
behind a cache, and one route-analysis endpoint. There is no database.

```
DEM (3DEP / LINZ) ──┬──> Cesium ion ──────────> quantized-mesh terrain
                    └──> slope / aspect / elev ─> packed RGBA ──> XYZ PNG tiles
Sentinel-2 ─────────────> mask ─> topo correct ─> composite ──> XYZ JPEG tiles
                                                       │
                                          static hosting (Cloudflare R2)
                                                       │
        Flask API  ──── /api/bulletin ────────>  Web (CesiumJS + GLSL)
                   ──── /api/route/analyze ──>  Mobile (Unity + RevenueCat)
```

The core trick: terrain attributes are **packed into RGBA tiles and filtered in a shader**
on the client, rather than baked into a fixed overlay. Dragging a slider recomputes the
whole range at 60fps with zero network traffic.

| Channel | Value | Range | Precision |
| --- | --- | --- | --- |
| R | slope angle (deg) | 0–90 | 0.353° |
| G | aspect (deg) | 0–360 | 1.412° |
| B | elevation (m) | 0–4000 | 15.686 m |
| A | validity | 0 or 255 | — |

> ⚠️ The B channel is **too coarse for runout modelling** (15.7 m vertical). The runout
> kernel loads a separate raw `f32` DEM. See spec §12.4.

---

## Layout

```
config/aoi/          AOI definitions — bbox, sources, bulletin adapter, season
pipeline/            Offline data pipeline (Python + GDAL), runs once per AOI
api/                 Flask app: bulletin proxy + normalizer, route analysis
api/bulletin/        One adapter per national bulletin format
web/                 CesiumJS frontend (Client)
crates/whumpf-runout Rust runout kernel → WASM (web) + native (iOS/Android)
tests/               Round-trip and normalization tests
```

## Areas of interest

| AOI | Slug | Bulletin | Season | Role |
| --- | --- | --- | --- | --- |
| Castle Peak / Donner Summit, CA | `castle-peak` | Sierra Avalanche Center | Nov–May | Narrative opener (fixture) |
| Craigieburn / Arthur's Pass, NZ | `craigieburn` | NZ Avalanche Advisory | May–Nov | **Live data** |

Two AOIs. Adding a third is scope creep — add features, not area.

---

## Setup

Requires Python 3.11+ and GDAL 3.6+ with the command-line tools on `PATH`.

```bash
# GDAL (macOS)
brew install gdal
# GDAL (Debian/Ubuntu)
sudo apt install gdal-bin libgdal-dev

python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env    # then fill in ION_TOKEN, LINZ_API_KEY
```

Verify:

```bash
make check          # gdal present, python deps, env vars
pytest              # round-trip packing test must pass before anything else
```

## Running the pipeline

```bash
make terrain    AOI=castle-peak    # download DEM, warp, clip, upload to ion
make attributes AOI=castle-peak    # slope/aspect/elev -> packed RGBA -> PNG tiles
make imagery    AOI=castle-peak    # STAC -> mask -> topo correct -> composite -> tiles
make all        AOI=castle-peak
```

Each step is independently re-runnable and writes to `data/<aoi>/`.

## Running the API

```bash
flask --app api.app run --debug
curl 'localhost:5000/api/bulletin?aoi=craigieburn'   # live
curl 'localhost:5000/api/bulletin?aoi=castle-peak'   # fixture
```

---

## Data sources & attribution

All source data is public. Attribution is required and is surfaced in-app.

| Source | Licence |
| --- | --- |
| USGS 3DEP elevation | Public domain |
| LINZ elevation & aerial imagery | CC BY 4.0 |
| Copernicus Sentinel-2 | Free, full & open |
| USDA NAIP | Public domain |
| avalanche.org / Sierra Avalanche Center | Bulletin content © issuing centre |
| NZ Avalanche Advisory | Bulletin content © NZ Mountain Safety Council |

## Licence

MIT — see [LICENSE](./LICENSE).
