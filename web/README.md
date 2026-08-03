# WHUMPF web frontend

CesiumJS. Owner: **Client**.

## Run it

```bash
cd web
npm install
cp .env.example .env    # add VITE_ION_TOKEN
npm run dev             # http://localhost:5173
```

Run the API in another terminal so the bulletin panel has data:

```bash
flask --app api.app run --debug
```

It works without the API too — the panel shows "No bulletin available" and the
slope and manual modes still function.

## You are not blocked on the pipeline

The scaffold runs against **Cesium World Terrain** and a **generated test tile**
(`testTile.js`) that encodes a synthetic cone using the same channel packing as
the real tiles. The shader can be developed and tuned entirely against it.

Two swaps when the pipeline lands:

1. `loadTerrainForAoi()` already reads `ion_asset_id` from `/api/aois` — it
   switches automatically once the config has a real ID.
2. Replace `makeTestAttributeTile()` in `main.js` with a
   `UrlTemplateImageryProvider` pointing at the R2 attribute tiles.

## Files

| | |
| --- | --- |
| `index.html` | layout, four mode panes, disclaimer modal |
| `style.css` | dark theme, responsive below 860px |
| `main.js` | state, data loading, controls, uniform wiring |
| `attributeMaterial.js` | the GLSL material and uniform helpers |
| `testTile.js` | synthetic attribute tile for development |

## The shader

`attributeMaterial.js` decodes the packed channels and filters per fragment.
Texel components arrive normalised to 0..1, so multiply by the range:

```glsl
float slope  = texel.r * 90.0;
float aspect = texel.g * 360.0;
float elev   = texel.b * 4000.0;
```

This must stay in sync with `pipeline/attributes.py::unpack`. If they drift the
overlay is wrong in a way that still looks plausible.

| Uniform | Purpose |
| --- | --- |
| `u_mode` | 0 off, 1 slope ramp, 2 bulletin, 3 manual |
| `u_aspectMask` | 8-bit, one bit per octant (N=0 … NW=7) |
| `u_slopeMin` / `u_slopeMax` | degrees |
| `u_elevMin` / `u_elevMax` | metres |
| `u_dangerColor` | vec3 |
| `u_opacity` | float |

Filtering on the GPU is why the sliders update the whole range instantly with no
network traffic.

## Modes

**1 — Slope angle.** Standard ramp: 27–29 yellow, 30–34 orange, 35–45 red,
46–50 dark red, 50+ purple.

**2 — Bulletin.** Uniforms come straight from `/api/bulletin`. The server has
already resolved the aspect rose to `aspect_mask` and the named bands to
`elev_min_m` / `elev_max_m`, so the client does no forecast arithmetic.

**3 — Manual.** Octant toggles and range sliders.

## Camera

`flyToAoi()` positions south of the bbox at a −22° pitch, looking across the
range rather than down at it. Tune the pitch and distance once real terrain is
loaded — the placeholder framing will not be right.

## Safety surfaces — do not remove

- `#staleness` badge: LIVE / ARCHIVED BULLETIN / EXPIRED BULLETIN
- `#attribution`: issuing centre, issue time, expiry time, data sources
- Expired bulletins render grey, never in danger colours (`applyUniforms()`)
- Disclaimer modal on first load

These are the difference between a defensible tool and a liability. See
[DISCLAIMER.md](../DISCLAIMER.md).

## Still to build

- [ ] Route drawing, clamped to terrain, posting to `/api/route/analyze`
- [ ] Elevation profile strip with flagged segments
- [ ] Real attribute tile layer via `UrlTemplateImageryProvider`
- [ ] Winter imagery layer
- [ ] Persist the disclaimer dismissal
- [ ] Loading and error states for the bulletin fetch
