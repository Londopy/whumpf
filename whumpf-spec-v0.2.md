# WHUMPF — Technical Spec v0.2

**3D backcountry terrain + avalanche bulletin projection**

> **Name:** *whumpf* — the sound a weak layer makes when it collapses under you and the fracture propagates outward. It is the single most unambiguous field observation in avalanche safety: if you hear it, the snowpack is telling you it will fail. The whole product is an attempt to give you that signal *before* you are standing on the slope.
>
> Previously specced as ASPECT. Renamed v0.2.

| | |
| --- | --- |
| **Repo** | `github.com/Londopy/whumpf` |
| **Team** | **Data** — pipeline, cartography, API |
| | **Client** — 3D rendering, UI, mobile |
| **Window** | Aug 3 – Sep 30, 2026 (8 weeks, part-time) |
| **Status** | Pre-build |
| **License** | MIT or Apache-2.0 — **required**, see §2.3 |

---

## 0. What changed from v0.1

v0.1 was written as a 48-hour, single-deadline, web-only sprint. Five things forced a rewrite:

1. **Three hackathons, not one**, with cascading deadlines. The web build is no longer the deliverable — it is the first milestone of three.
2. **RevenueCat Shipaton requires a mobile app with a real in-app purchase.** Web-only is ineligible. This is the single largest structural change.
3. **Eight weeks, not forty-eight hours.** The build order in v0.1 §8 is obsolete. Things v0.1 cut as "distraction" — offline maps, accounts, mobile — are now both feasible and load-bearing, because they are what people pay for.
4. **The off-season problem is solved.** New Zealand is in peak avalanche season *right now*. Live bulletin data is available through September. The "ship a frozen fixture" mitigation in v0.1 is demoted to a fallback.
5. **Monetization is now a design constraint**, not an afterthought. §9 is new.

What survives unchanged from v0.1: the packed-attribute-tile trick (§6.2), the shader filter (§7.2), topographic illumination correction (§6.3c), and the Rust runout kernel (§12). Those were the good parts. They are all still the good parts.

---

## 1. The Pitch

FATMAP was the best 3D backcountry planning tool ever built. Strava acquired it in January 2023 and shut it down on **October 1, 2024**. Nothing replaced the 3D winter map or the terrain-planning workflow.

Winter 2025–26 was one of the deadliest avalanche seasons on record. **18 US deaths by late February, 12 of them in a single week**, including 9 skiers near Castle Peak, California. Mountain rescue in Pongau said the warnings had been *"clear and repeated."*

That is the whole problem. The forecasts were correct and published. They just did not reach the slope. A bulletin that reads:

> Persistent slab. N through NE aspects. Above 2400m. 30–45 degrees.
> Danger: **CONSIDERABLE (3)**.

…is a paragraph of text. It is not an answer to *"is the slope I am standing in front of one of those slopes?"*

**WHUMPF projects the bulletin onto the actual mountain in 3D.** Every slope matching today's problem lights up. You rotate the terrain, you see exactly which bowls and gullies are loaded, and you see whether your intended skin track crosses one.

> ⚠️ **Pitch framing:** State the season once, factually. Do not dwell on the deaths. Do not reference the August 1 Broad Peak avalanche — that is an 8000m expedition accident and no mapping app changes that outcome. Lead with the capability gap, not the body count.

---

## 2. Hackathon Strategy

Three events, three deadlines, one codebase. The web build and the mobile build share an entire backend — the tile pipeline, the bulletin normalizer, the hosting. Only the render layer is rebuilt, and the client team would rebuild that for mobile regardless.

| Event | Deadline | Deliverable | Realistic value |
| --- | --- | --- | --- |
| **Reverie Hacks** | **Aug 17** | Repo + demo video + docs | Certificate. Low stakes. |
| **HackSocial** | **Aug 31** | Repo + description | ~$500 credits, Boot.dev year, .xyz domain |
| **RevenueCat Shipaton — Next Gen** | **Sep 30** | Video + open-source repo + RevenueCat IAP | **$15k / $10k / $5k** |

**XPRIZE Gemini is out.** It requires a registered business with verifiable revenue, a P&L, and customer contact details by Aug 17, with AI agents running in production. Its five categories are all economic-access themed. Avalanche safety fits none of them, and the age floor likely disqualifies us outright.

> **Verify before double-submitting.** Check the Reverie and HackSocial rulesets for exclusivity clauses. Only the overview pages have been read so far.

### 2.1 Why the small two are worth entering

Not for the prizes — for the deadlines. Reverie on Aug 17 forces the H10 checkpoint from v0.1 (slope shading on real terrain) to actually exist by a fixed date, with an audience. HackSocial on Aug 31 forces the same for the mobile port. The marginal cost of each submission after the work is done is roughly two hours: a video, a README, a description.

HackSocial's **Visual Design track** is the right entry lane. 3D terrain with a live shader overlay is exactly what that track rewards, and with 14 registered participants the odds are unusually good.

### 2.2 Shipaton Next Gen — what it does and does not waive

| Requirement | Next Gen |
| --- | --- |
| Published App Store / Play / Galaxy listing | ❌ **Waived** |
| Paid Apple/Google developer account | ❌ **Waived** |
| Free trial or judge promo code | ❌ **Waived** |
| Public open-source repo **with detectable license file** | ✅ **Added — required** |
| Runs on iOS / iPadOS / **macOS** / Android | ✅ Still required |
| **RevenueCat SDK powering ≥1 in-app purchase** | ✅ **Still required** |
| First public release inside Aug 1 – Sep 30 window | ✅ Still required |
| ≤2 min demo video, 1024×1024 icon, 1179×2556 screenshot | ✅ Still required |

Two consequences worth internalising:

- **The SDK is not optional.** Next Gen lowers distribution friction, not product scope. There must be a real paywall and a real purchase flow. RevenueCat's Test Store lets purchases work end-to-end without store setup or real money — that is the path.
- **macOS is an eligible platform.** If the iOS/Android build is in trouble in week 7, a Mac Catalyst or native macOS target is a legal submission. Keep this in the back pocket; do not plan around it.

### 2.3 Two admin items that will silently disqualify us

1. **Devpost account email must be academic.** Next Gen eligibility is verified against `JetBrains/swot`. A gmail address fails. Whoever is registered as the team **Representative** needs a `.edu`-or-equivalent address on their Devpost profile. **Fix this in week 1.** It is a five-minute task that invalidates eight weeks of work if missed.
2. **`LICENSE` file at repo root, from day one.** The rules require the license be *detectable and visible in the About sidebar*. GitHub only populates that from a recognised license file at root. MIT or Apache-2.0. Commit it with the initial scaffold, not at the end.

---

## 3. Scope

### In scope

- **Two** areas of interest, fully processed at high resolution — one Northern, one Southern (§4)
- 3D terrain from real LiDAR-derived elevation
- Winter satellite basemap, custom-processed
- Slope angle + aspect + elevation overlay, shader-filtered
- Live avalanche bulletin ingest from **two national formats**, projected onto terrain
- Draw/import a route, see where it crosses flagged terrain
- **Native mobile app** with offline region download
- **RevenueCat paywall** gating offline + multi-region + runout

### Out of scope

- Global coverage. Two AOIs done well beats a continent done badly.
- User accounts / auth / cloud sync — RevenueCat's anonymous app-user IDs cover entitlement without a login screen
- Turn-by-turn routing / navigation
- Guidebook or UGC content layer
- Weather forecasting, snowpack modelling, anything that would constitute issuing our own forecast

> The single most likely way this project fails is scope creep into coverage. Resist it. Judges reward one thing that works over five things that half-work.

### 3.1 Liability posture

We display official bulletins. We never generate, interpolate, or modify a forecast. The overlay is a *visualisation of a published product*, not a recommendation. Every screen showing projected terrain carries a persistent attribution line naming the issuing centre, the issue time, and the expiry time. An expired bulletin greys the overlay and shows a banner. First launch shows a one-screen disclaimer.

This is not legal boilerplate — it is the difference between a defensible tool and a liability. It is also, bluntly, what a judge in the Peace Prize category will look for.

---

## 4. Areas of Interest

### 4.1 Primary (Northern) — Castle Peak / Donner Summit, CA

```
bbox: -120.42, 39.28  →  -120.28, 39.38
size: ~12 km × 11 km
```

- Direct tie to the Feb 2026 incident that killed 9 skiers. The demo is literally the terrain from the news.
- Full USGS 3DEP **1m LiDAR** coverage
- Sierra Avalanche Center publishes through the avalanche.org API
- Heavily skied, so the audience recognises it

**This is the narrative AOI.** It opens the demo. In August–September its bulletin is dormant, so it runs on a snapshotted fixture — framed deliberately: *"this is the bulletin that was live the day nine people died."*

### 4.2 Live (Southern) — Craigieburn Range / Arthur's Pass, NZ — ⭐ **new in v0.2**

The New Zealand Avalanche Advisory forecasts 13 alpine regions roughly **May through November**. It is peak season there now and will still be running on Sep 30.

This converts the weakest row in the v0.1 risk table into a strength. The demo shows **today's real bulletin, projected onto real terrain, fetched live on stage.** No fixture, no hedging, no "imagine it's February."

It also produces a much better technical claim than one AOI would: *we ingest two unrelated national bulletin formats and normalise them into one terrain filter.* That is a genuine architecture story, not a coverage brag.

**Verify before committing (week 1, hard gate):**
- LiDAR DEM coverage via **LINZ Data Service** / Environment Canterbury, or OpenTopography's NZ holdings. Canterbury has been flown, but confirm the specific bbox.
- NZAA bulletin structure — it is **not** the avalanche.org schema. Inspect the actual payload before designing the adapter.
- If 1m LiDAR is unavailable for the chosen bbox, fall back to the LINZ 8m national DEM. Still far better than the 30m global DEM every other app uses.

**Fallback if NZ tiling is a problem:** Tongariro (North Island, July–October season) or Wakatipu/Remarkables. Do not fall back to a second US AOI — that loses the live-data property, which is the entire point.

> Do not expand beyond two AOIs. If you finish early, add features, not area.

---

## 5. Data Sources

### Elevation

| Region | Source | Notes |
| --- | --- | --- |
| US | **USGS 3DEP 1m DEM** — public domain, no key | `s3://prd-tnm/StagedProducts/Elevation/1m/` · [downloader](https://apps.nationalmap.gov/downloader/) |
| US fallback | 3DEP 1/3 arc-second (~10m) | Seamless national coverage |
| NZ | **LINZ Data Service** LiDAR DEM | Free, CC-BY 4.0, requires free API key |
| NZ fallback | LINZ 8m national DEM | Seamless |

### Imagery — winter

**Sentinel-2 L2A** via Microsoft Planetary Computer STAC — `https://planetarycomputer.microsoft.com/api/stac/v1`, collection `sentinel-2-l2a`. Free, anonymous token endpoint. 10m RGB (B04/B03/B02), ~5 day revisit.

- **Northern AOI:** query March–April, 2023–2026, cloud cover < 20%
- **Southern AOI:** query **August–September**, 2023–2026 — *note the hemisphere flip; this is an easy and expensive mistake to make*

**NAIP** aerial 0.6m (collection `naip`) for the hybrid luminance blend (§6.3f). **US only** — there is no NAIP equivalent for NZ. LINZ aerial imagery is the analogue, available at 0.3–0.5m for much of the country under CC-BY.

### Avalanche bulletins

**US — avalanche.org public API**, no key:

```
https://api.avalanche.org/v2/public/products?center_id=SAC
https://api.avalanche.org/v2/public/product?type=forecast&center_id=SAC&zone_id=<id>
```

**NZ — New Zealand Avalanche Advisory**, `avalanche.net.nz`. Schema differs from avalanche.org. Inspect the live payload and write a dedicated adapter (§6.4).

### Terrain tiling

- **Cesium ion** free tier (5GB) — upload GeoTIFF, get hosted quantized-mesh
- Self-hosted fallback: `docker run tumgis/ctb-quantized-mesh`

---

## 6. The Pipeline *(Data)*

Unchanged in substance from v0.1 — it was right. Two additions: it now runs twice (once per AOI), and §6.4 grows a second adapter.

### 6.1 Terrain

```bash
gdalbuildvrt aoi.vrt *.tif
gdalwarp -t_srs EPSG:3857 -r cubic -co COMPRESS=DEFLATE aoi.vrt aoi_3857.tif
gdal_translate -projwin <bbox> aoi_3857.tif aoi_clip.tif
```

Upload `aoi_clip.tif` to Cesium ion as **3D Terrain**. Note the asset ID.

Self-host fallback:

```bash
docker run -v $PWD:/data tumgis/ctb-quantized-mesh \
  ctb-tile -f Mesh -C -N -o /data/terrain /data/aoi_clip.tif
```

**Parameterise this by AOI from the start.** A config dict keyed by AOI slug — bbox, source URLs, ion asset ID, bulletin adapter, season months. Do not hardcode Castle Peak and then hand-edit for NZ. You will run this pipeline more than twice.

### 6.2 Terrain attribute tiles — ⭐ **the core trick**

Do **not** compute slope/aspect at runtime, and do **not** bake a fixed overlay image. Pack terrain attributes into an RGB tile pyramid and filter them in a shader on the client. The overlay then recomputes instantly when the bulletin changes or the user drags a slider.

```bash
gdaldem slope  aoi_clip.tif slope.tif  -compute_edges
gdaldem aspect aoi_clip.tif aspect.tif -compute_edges -zero_for_flat
```

**Channel packing** (single RGBA PNG pyramid):

| Channel | Value | Range | Scale |
| --- | --- | --- | --- |
| R | slope angle (deg) | 0–90 | × 2.83 |
| G | aspect (deg) | 0–360 | × 0.708 |
| B | elevation (m) | 0–4000 | × 0.0638 |
| A | validity | 255 valid / 0 nodata | — |

Build with `numpy` + `rasterio`, write with `gdal2tiles.py -p mercator -z 10-15`.

> 🚨 **PNG only, nearest-neighbour resampling.** JPEG compression will corrupt your packed values and the overlay will shimmer.

**Sanity check before moving on:** sample a known pixel, unpack it, confirm the slope matches what `gdaldem` reported. Write this as an actual test, not a one-off script — it will run again for the NZ AOI. This will save you three hours later.

### 6.3 Winter imagery

Order of operations matters. Do them in this sequence.

**a) STAC search** — `pystac-client` against Planetary Computer. `bbox` = AOI, `datetime` = the AOI's configured season window, `eo:cloud_cover < 20`. Expect 15–40 candidate scenes.

**b) Cloud + shadow mask** — Use the SCL band. Keep classes `4, 5, 11` (veg, bare, snow). Drop `3, 8, 9, 10` (shadow, cloud med, cloud high, cirrus). Do **not** trust the scene-level `cloud_cover` number alone.

**c) Topographic illumination correction** ← *biggest visual win*

You have the DEM. Compute per-pixel solar incidence:

```
cos(i) = cos(slope)·cos(sun_zenith)
       + sin(slope)·sin(sun_zenith)·cos(sun_azimuth − aspect)
```

Sun angles come from scene metadata (`MEAN_SOLAR_ZENITH_ANGLE`, `MEAN_SOLAR_AZIMUTH_ANGLE`). Then apply SCS+C:

```
rho_corrected = rho · (cos(slope)·cos(sun_zenith) + c) / (cos(i) + c)
```

where `c = b/m` from a linear regression of `rho` against `cos(i)`.

This pulls real detail out of shadowed polar-facing slopes — exactly the aspects that slide. Almost no consumer app does this. It is the single thing that will make your imagery look better than onX's.

> **Hemisphere note:** in the Southern AOI the loaded aspects are **S through SE**, and the shadowed faces are south-facing. The maths is identical; the interpretation is mirrored. Do not hardcode "north faces are the dangerous ones" anywhere in the code or the copy.

**d) Composite** — Per-pixel 60th percentile across all masked, corrected scenes. Median is safer with fewer scenes.

**e) Stretch** — Percentile clip at 2/98, **not** min/max. Snow saturates and default stretches produce flat white mush. Check a histogram.

**f) Optional — hybrid detail blend** — Pull NAIP 0.6m (US) or LINZ aerial (NZ). Convert both to LAB. Take **L** from the high-res source, **a/b** from the winter composite, recombine. Not physically honest. Looks fantastic. *Skip if behind schedule — polish, not core.*

**g) Tile**

```bash
gdal2tiles.py -p mercator -z 10-16 -r bilinear --xyz composite.tif tiles/
```

### 6.4 Bulletin ingest — two adapters, one shape

`GET /api/bulletin?aoi=<slug>` — fetch upstream, cache 30 min, normalise to:

```json
{
  "source": { "center": "SAC", "name": "Sierra Avalanche Center", "url": "..." },
  "danger": { "upper": 3, "middle": 3, "lower": 2 },
  "problems": [
    {
      "type": "Persistent Slab",
      "likelihood": "Likely",
      "size": [1, 3],
      "aspects": ["N", "NE", "E"],
      "elevations": ["upper", "middle"],
      "slope_min": 30,
      "slope_max": 50
    }
  ],
  "issued": "...",
  "expires": "...",
  "is_stale": false
}
```

Both the avalanche.org rose object and the NZAA payload flatten into this. The shader wants a simple aspect bitmask and an elevation range, not a rose.

**Elevation bands are relative, not absolute.** "Upper / middle / lower" are defined per-zone by the forecast centre against local treeline and alpine boundaries. Store the metres-above-sea-level breakpoints per AOI in config and resolve them at normalise time. Getting this wrong makes the overlay confidently and invisibly incorrect — which is worse than it not working.

Ship a hardcoded fixture of the Feb 2026 Sierra bulletin for the Northern AOI. The Southern AOI runs live.

---

## 7. Frontend — Web *(Client)*

**Stack:** CesiumJS, vanilla JS or light React.

> **Why Cesium over MapLibre:** FATMAP's signature was the low oblique camera looking *across* a range. Cesium handles horizon, curvature, and quantized-mesh terrain far better at those angles.

This is the Aug 17 / Aug 31 deliverable and the reference implementation the mobile build is ported from.

### 7.1 Base scene

- `CesiumTerrainProvider` from ion asset ID
- `UrlTemplateImageryProvider` → winter imagery tiles on R2
- Camera constrained to AOI bbox; initial view a low oblique of Castle Peak
- **Kill the default Cesium chrome** (timeline, animation, base layer picker, geocoder, home button, fullscreen). It makes the demo look like a GIS tutorial instead of a product.

### 7.2 Attribute layer + shader — ⭐ **the core feature**

Load the packed attribute tiles as a second imagery layer. Apply a custom Cesium Material / GLSL fragment shader.

**Uniforms**

| Uniform | Type | Purpose |
| --- | --- | --- |
| `u_aspectMask` | int | 8-bit, one bit per compass octant |
| `u_elevMin` / `u_elevMax` | float | elevation band |
| `u_slopeMin` / `u_slopeMax` | float | slope range |
| `u_dangerColor` | vec3 | overlay color |
| `u_opacity` | float | overlay alpha |
| `u_mode` | int | 0 = off, 1 = slope-only, 2 = bulletin |

**Per fragment**

```glsl
// unpack slope / aspect / elev from RGB
int octant = int(floor((aspect + 22.5) / 45.0)) % 8;
bool match = (u_aspectMask & (1 << octant)) != 0
          && elev  >= u_elevMin  && elev  <= u_elevMax
          && slope >= u_slopeMin && slope <= u_slopeMax;
gl_FragColor = match ? vec4(u_dangerColor, u_opacity) : vec4(0.0);
```

Because filtering happens in the shader, dragging a slider updates the whole mountain at 60fps with zero network traffic. **This is the demo moment.** Preserving it is the primary constraint on the mobile platform choice in §8.

### 7.3 Modes

**Mode A — Slope angle shading** *(classic)* — 27–29 yellow · 30–34 orange · 35–45 red · 46–50 dark red · 50+ purple. Everyone recognises this instantly.

**Mode B — Bulletin projection** *(the differentiator)* — Pull `/api/bulletin`, feed problem params into the shader uniforms. Bulletin text in a side panel with the matching terrain lit. Tab between multiple problems.

**Mode C — Manual** *(the toy)* — Sliders for aspect octants, elevation band, slope range. Judges will play with this. Make it feel good.

### 7.4 Route tool

- Click to draw a polyline, clamped to terrain
- `POST /api/route/analyze` with the coordinates
- Backend samples slope/aspect/elev along the line, intersects with the active bulletin problem, returns flagged segments
- Render flagged segments in red on the 3D line + an elevation profile strip along the bottom with matching colouring
- *"Your skin track crosses 240m of flagged terrain"* is a hell of a headline

---

## 8. Frontend — Mobile ⭐ **new in v0.2**

### 8.1 The constraint

The shader-based instant recompute (§7.2) *is* the product. Any mobile stack that cannot run a custom fragment shader over a draped raster on 3D terrain reduces WHUMPF to a static overlay viewer, which is not worth building. Platform choice follows from this and nothing else.

### 8.2 Options

| Option | 3D terrain | Custom shader | RevenueCat | Risk |
| --- | --- | --- | --- | --- |
| **Cesium for Unity** | ✅ Native quantized-mesh | ✅ ShaderLab/HLSL, maps ~1:1 from GLSL | ✅ First-class Unity SDK | Unity learning curve; ~40MB base |
| **MapLibre Native** + custom layer | ✅ raster-dem terrain | ⚠️ Raw GL/Metal custom layer — real work | ✅ via Flutter/native SDK | Graphics-API depth |
| **Mapbox Maps SDK** | ✅ Best-in-class | ❌ No custom fragment shaders exposed | ✅ | Kills the demo moment |
| **CesiumJS in a WebView** | ✅ | ✅ | ✅ | Thin-wrapper smell; legal under Next Gen |

### 8.3 Recommendation

**Cesium for Unity, with RevenueCat's Unity SDK.** It is the only option that preserves the shader story intact, it reuses the ion assets already produced in §6.1, and the GLSL from §7.2 ports to HLSL almost line-for-line. RevenueCat ships a first-class Unity SDK with Paywalls and Customer Center support, so the monetization surface is close to drop-in.

**Fallback, in order:**
1. MapLibre Native with a custom layer, if Unity proves hostile by end of week 3.
2. WebView wrapper. This is explicitly legal under Next Gen — there is no App Review to fail, and judges assess the video and repo. It is the escape hatch, not the plan. If it is invoked, invoke it by **week 6** so there is still time to polish.

> **Hard decision gate: end of week 3 (Aug 24).** Spike Unity for two days. If a textured Cesium tileset with one custom material is not rendering on a real device by then, take fallback 1 and do not look back. Dithering here is the highest-variance failure mode in the whole plan.

### 8.4 Offline regions

The paid feature, and the one that makes this a real backcountry tool rather than a demo. Backcountry means no signal — an online-only avalanche app is a contradiction.

- Region = AOI bbox × zoom 10–16, imagery + attribute tiles + terrain + the last-fetched bulletin
- Package as a single archive per region; download with resumable transfer and a visible size estimate
- Store the bulletin's `issued`/`expires` alongside; on launch without connectivity, show the cached bulletin with a prominent staleness banner
- Estimate ~200–400 MB per AOI at z16. Show the number before download, not after.

---

## 9. Monetization ⭐ **new in v0.2**

Required by the rules, but it should be designed as if it were not. The model below is what Gaia GPS, onX Backcountry, and FATMAP itself all converged on, because it is the one that matches how the product is actually used.

### 9.1 Tiers

| | Free | **Whumpf Pro** |
| --- | --- | --- |
| 3D terrain, one region | ✅ | ✅ |
| Live bulletin + projection | ✅ | ✅ |
| Slope angle shading | ✅ | ✅ |
| Manual filter sliders | ✅ | ✅ |
| **Offline region download** | — | ✅ |
| **All regions** | — | ✅ |
| **Route save + GPX import/export** | — | ✅ |
| **Runout modelling** (§12) | — | ✅ |

### 9.2 Pricing

- **$4.99/mo** · **$29.99/yr** · **$79 lifetime**
- 7-day free trial on the annual plan

Two deliberate choices. First, **the safety-critical path is never paywalled.** Seeing today's bulletin projected onto the mountain in front of you is free, forever, with no account. Paywalling that would be indefensible, and a Peace Prize judge would be right to say so. What costs money is *planning convenience* — offline, multi-region, saved routes, modelling.

Second, **annual is the hero SKU** because the product is seasonal. A monthly subscriber churns in April. The pricing page should say so plainly: *"one season, one price."*

### 9.3 RevenueCat integration

- Entitlement: `pro`. Offerings configured remotely so the paywall can be changed without a rebuild.
- Anonymous app-user IDs — no login screen, no accounts, no PII. Aligns with §3's scope exclusions.
- **Test Store** for development; purchases behave like real subscriptions with no money and no store setup. This is what makes Next Gen viable without a paid developer account.
- Paywall triggers: tapping *Download for offline*, tapping a second region, tapping *Save route*, tapping *Model runout*. Contextual, at the moment of intent — never an interstitial on launch.

---

## 10. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  OFFLINE PIPELINE (Python + GDAL, runs once per AOI)         │
│                                                              │
│  DEM (3DEP / LINZ) ──┬──> Cesium ion ──> quantized-mesh      │
│                      ├──> gdaldem slope                      │
│                      ├──> gdaldem aspect                     │
│                      └──> elevation bands                    │
│                            └──> PACK INTO RGBA ──> XYZ PNG   │
│                                                              │
│  Sentinel-2 ──> cloud mask ──> topo correction               │
│            ──> composite ──> hi-res blend                    │
│            ──> gdal2tiles ──> XYZ JPEG                       │
└──────────────────────────────────────────────────────────────┘
                            │
                  static hosting (Cloudflare R2 / Pages)
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────────────────────┐          ┌────────────────────────────┐
│  Flask API (thin)     │          │  CLIENTS                   │
│   /api/bulletin       │<─────────│                            │
│     ├─ SAC adapter    │          │  Web: CesiumJS + GLSL      │
│     └─ NZAA adapter   │          │  Mobile: Unity + Cesium    │
│   /api/route/analyze  │<─────────│    + RevenueCat SDK        │
└───────────────────────┘          │    + offline region store  │
                                   │    + whumpf-runout (FFI)   │
                                   └────────────────────────────┘
```

Almost everything is static files. The backend is deliberately thin — two bulletin adapters behind a cache, and one route-analysis endpoint. **Do not build a database.**

---

## 11. Build Order

Eight weeks, part-time, two people. Front-load the pipeline — the frontend cannot be tested until real tiles exist.

### Week 1 · Aug 3–9 — Foundations

| Data | Client |
| --- | --- |
| Repo + **LICENSE file**. AOI config scaffold. ion account, R2 bucket. **Start 3DEP download immediately** — it is slow. | Cesium scaffold against ion World Terrain (placeholder). Camera, chrome stripped, layout shell. |
| **Verify NZ LiDAR coverage** (§4.2 hard gate). Inspect NZAA payload. | |
| **Fix the Devpost academic email** (§2.3). | |

Terrain warp + ion upload. Get a bare 3D mountain on screen.

> ✅ **CHECKPOINT — real 1m Castle Peak visible in the browser.** If not, stop and fix. Everything downstream depends on this.

### Week 2 · Aug 10–17 — Web MVP → **Reverie deadline Aug 17**

| Data | Client |
| --- | --- |
| Attribute tiles packed + unpack test. Bulletin fixture + normalizer. | Shader material. Mode A slope shading. Mode C sliders. |

> ✅ **CHECKPOINT — slope-angle shading working on real terrain. You now have a viable, demoable product.** Everything after is upside.
>
> **Ship it:** README, 2-min video, submit to Reverie.

### Week 3 · Aug 18–24 — Second AOI + platform decision

| Data | Client |
| --- | --- |
| NZ pipeline run end-to-end. NZAA adapter. | **Unity spike (2 days).** Cesium tileset + one custom material on device. |
| Sentinel-2 pull, mask, topo correction. | Mode B bulletin projection on web. |

> ⚠️ **HARD GATE Aug 24 — mobile platform locked** (§8.3). No revisiting.

### Week 4 · Aug 25–31 — Mobile core → **HackSocial deadline Aug 31**

| Data | Client |
| --- | --- |
| Imagery tiling + upload, both AOIs. | Mobile: terrain + imagery + attribute layer + shader parity with web. |

> **Ship it:** submit to HackSocial, Visual Design track. Same repo, updated description.

### Week 5 · Sep 1–7 — Money

| Data | Client |
| --- | --- |
| Offline region packaging + size estimates. | RevenueCat SDK, entitlement, paywall screens, Test Store purchase flow end-to-end. |

### Week 6 · Sep 8–14 — Route + runout

| Both |
| --- |
| Route tool: backend sampling, mobile draw, elevation profile. `whumpf-runout` native build (§12). |

> ⚠️ **Last call for WebView fallback** if mobile is still fighting.

### Week 7 · Sep 15–21 — Polish

| Data | Client |
| --- | --- |
| Attribution / staleness / disclaimer surfaces (§3.1). Repo hygiene, README, setup docs. | Design pass. App icon 1024×1024. Screenshot 1179×2556 no frame. Animation and transitions. |

> 🔒 **FEATURE FREEZE Sep 21.** Nothing new after this date.

### Week 8 · Sep 22–30 — Submission

| Both |
| --- |
| Demo video (≤2 min, hard limit). Devpost writeups: Next Gen, Peace Prize, Design Award, #BuildInPublic. Final repo pass — verify LICENSE renders in the About sidebar. **Submit Sep 30.** |

---

## 12. Rust Component — Runout Kernel

> **Scope discipline:** exactly one crate, `whumpf-runout`. Everything else stays Python + JS + C#. This is a load-bearing component, not a flex.

### 12.1 Why Rust here specifically

Runout propagation is an iterative cellular automaton over a grid: path-dependent, branchy, and fundamentally not vectorizable. There is no numpy trick that saves you — this is the one place in the project where Python is 50–100× slower with no escape hatch. Flow-Py itself is Python, and it is slow.

**v0.2 change: three targets, one crate.** WASM for the web build, and native static libs for iOS and Android via `uniffi` (or `cbindgen` + `cargo-ndk`). On mobile there is no WASM step at all — it compiles straight to the platform, which is *simpler* than the web path, not harder.

> *"One Rust crate, compiled to WASM for the web and natively for iOS and Android, so runout modelling runs entirely on-device with no server round trip."*

That pairs with the shader story into one coherent architectural claim: **everything interactive runs on the client; the server only proxies a bulletin.**

### 12.2 Algorithm

**Ship (A) first. Structure the code so (B) drops in.**

**A — Alpha angle** *(Lied–Bakkehøi, do this one)*

A slide from a release point runs out to where the line back to the release point drops below angle α. Typical α is 18–25°; **23° is a reasonable conservative default** for large avalanches. For each cell, the cell is in the runout if it is downslope-connected to the release point *and*:

```
atan( (z_release − z_cell) / horizontal_distance ) ≥ α
```

Implemented as a downslope flood from the release cell, terminating per-path when the energy line condition fails. Well-established in the literature, easy to defend to a judge, and fast.

**B — Flow-Py style** *(stretch of the stretch)* — Multiple-flow-direction routing with a persistence term for momentum. Adds lateral spreading. Only attempt if (A) is done and tested.

### 12.3 Interface

Keep it dumb. One struct, one method.

```rust
pub struct RunoutEngine {
    dem: Vec<f32>,
    width: u32,
    height: u32,
    cell_size: f32,
}

impl RunoutEngine {
    pub fn new(dem: &[f32], width: u32, height: u32, cell_size: f32) -> Self { /* ... */ }

    /// Returns a mask, same dims as the DEM.
    /// 0 = not in runout, 1–255 = intensity / arrival confidence.
    pub fn compute(&self, start_x: u32, start_y: u32, alpha_deg: f32) -> Vec<u8> { /* ... */ }
}
```

The client turns the returned mask into a texture and drapes it — same path as the attribute layer, no new rendering concepts.

### 12.4 Getting the DEM to the client

⚠️ **Do not reuse the packed attribute tiles for this.** The B channel quantizes elevation to 0–4000m in 8 bits — roughly **15.7m vertical resolution**, far too coarse for an energy-line calculation.

Ship the whole AOI DEM as one raw `f32` blob, preloaded. At 10m over a 12 × 11 km AOI that is 1200 × 1100 × 4 bytes ≈ **5.3 MB**. One fetch, one `Float32Array`, done. On mobile it bundles into the offline region package. Runout at 10m is plenty — you do not need 1m, and downsampling makes it faster.

### 12.5 Crates

**Use:** `wasm-bindgen` (web target), `uniffi` (mobile targets), `console_error_panic_hook` (debugging only).

**Skip:** `ndarray` (binary weight; a plain `Vec<f32>` with manual indexing is simpler and faster to build) · `rayon` (**no threads in WASM** without `SharedArrayBuffer` + COOP/COEP; a single-threaded 1200 × 1100 sweep runs in milliseconds) · the `gdal` crate (system deps, no place here).

### 12.6 Testing

**Unit-test in native Rust against a synthetic cone DEM with a known analytic answer before you ever touch WASM or FFI.** `cargo test` natively, *then* build for the target. Do not debug energy-line math through devtools or Xcode — you will lose two hours to it.

### 12.7 Scheduling

Gated behind week 5. Native algorithm + tests first, FFI boundary second, client wiring third. **Cut cleanly at the Sep 21 freeze.** Nothing else depends on it, which is exactly why it is the right place for the one Rust component.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| **Devpost email not academic → Next Gen disqualified** | **Week 1. Five minutes. Do it first.** |
| **No LICENSE file / not detectable in About sidebar** | Commit at repo init. Verify it renders on GitHub before Sep 30. |
| **Unity spike fails, team dithers** | Hard gate Aug 24 (§8.3). WebView escape hatch is legal under Next Gen — invoke by week 6 at the latest. |
| NZ LiDAR gaps in AOI | Verify week 1. Fall back to LINZ 8m, then to Tongariro/Wakatipu. Never fall back to a second US AOI. |
| Hemisphere logic hardcoded to N faces | Aspect handling is data-driven from the bulletin. No literal `"N"` outside the adapters. |
| Elevation bands misresolved | Per-AOI breakpoints in config, resolved at normalise time. Test against a known bulletin. |
| 3DEP 1m has gaps | Check National Map viewer **before** committing. Fall back to 1/3 arc-sec. |
| Cesium ion upload fails / slow | Self-host CTB quantized-mesh via docker. Test the command *before* you need it. |
| Tile pyramid too large | Cap at z16. Clip AOI tighter. z16 at 1m source is already past data resolution. |
| JPEG artifacts corrupt attribute tiles | PNG only. Non-negotiable. Nearest-neighbour resampling. |
| Sentinel-2 all cloudy | Widen year range. Worst case ship Esri World Imagery — the bulletin projection is the differentiator, not the imagery. |
| Offline region download too large | Show size estimate before download. Cap z-level per region. Offer imagery-optional download. |
| Live demo network failure | Record a clean capture at week 7. Keep it in a background tab. |
| Shader precision / banding | 8-bit gives ~0.35° slope and ~1.4° aspect resolution. Fine. Dither on encode if aspect bands look chunky. |

---

## 14. Demo Video *(≤ 2 min — hard limit, judges stop watching)*

v0.1's script was four minutes for a live stage pitch. Shipaton wants two minutes of recorded footage. This is a different, tighter artifact — cut the roadmap, cut the technical credibility beat, cut the apology. Every second must show the product working.

**0:00–0:12** — Castle Peak in 3D, real 1m LiDAR, camera moving. Text overlay only: *"FATMAP shut down October 2024. Nothing replaced it."*

**0:12–0:30** — The bulletin panel. Let it sit. *"Persistent slab. North through northeast. Above 2400 metres. 30 to 45 degrees. That's accurate — and it's not an answer to the question you're actually asking."*

**0:30–0:45** — Hit the projection toggle. **The mountain lights up. Say nothing for two full seconds.** Rotate. Show the loaded bowls from three angles.

**0:45–1:00** — Drag the aspect and elevation sliders. Everything recomputes live. *"It's a shader reading packed terrain attributes — the whole range updates instantly, offline, on-device."*

**1:00–1:20** — Switch to New Zealand. *"This is today's live bulletin from the New Zealand Avalanche Advisory."* Show the timestamp. **This is the beat no competitor's demo can fake.**

**1:20–1:40** — Draw a route. *"Your skin track crosses 240 metres of flagged terrain."*

**1:40–1:55** — Offline download, then airplane mode, then the map still working. *"All of this is public data. USGS, LINZ, Copernicus, avalanche.org. It's been sitting there the whole time. Nobody put it on the mountain."*

**Stop.** No roadmap. No "if we had more time." Nobody cares, and it makes the working parts look accidental.

---

## 15. Devpost Category Writeups

Same project, four framings. Draft all four in week 8; they are cheap and each is an independent shot.

- **Next Gen** — primary. Student team, open-source repo, video. Lead with the technical depth: shader-packed terrain attributes, SCS+C topographic correction, a Rust kernel compiled to three targets.
- **Peace Prize** — strongest realistic shot. Public-safety information that exists and is correct but does not reach the people standing on the slope. Emphasise §3.1 and §9.2: the safety-critical path is free, forever, with no account.
- **Design Award** — explicitly judged separately from business viability. Point judges at the projection toggle, the live slider recompute, and the oblique camera work.
- **#BuildInPublic** — stackable, costs time not scope. Start posting in week 1. The pipeline work is visually compelling early — a hillshade, a first slope-shaded render, a topo-correction before/after. That before/after is the single most postable image in this project.

**Skip:** Grand Prize (judged on traction; we launch into the Northern off-season), HAMM (needs real revenue numbers), Catvertising (no ads), Best Game.

---

## 16. References

| | |
| --- | --- |
| USGS 3DEP downloader | https://apps.nationalmap.gov/downloader/ |
| LINZ Data Service | https://data.linz.govt.nz/ |
| OpenTopography | https://opentopography.org/ |
| MS Planetary Computer | https://planetarycomputer.microsoft.com/ |
| avalanche.org API | https://api.avalanche.org/v2/public/products |
| NZ Avalanche Advisory | https://www.avalanche.net.nz/ |
| NZAA User's Guide | https://www.avalanche.net.nz/education/userguide |
| CesiumJS docs | https://cesium.com/learn/cesiumjs/ |
| Cesium for Unity | https://cesium.com/platform/cesium-for-unity/ |
| RevenueCat Unity SDK | https://www.revenuecat.com/docs/getting-started/installation/unity |
| CTB quantized-mesh | https://github.com/tum-gis/cesium-terrain-builder-docker |
| gdaldem | https://gdal.org/programs/gdaldem.html |
| SCS+C correction | Soenen et al. 2005, IEEE TGRS |
| Flow-Py | https://github.com/avaframe/FlowPy |
| Shipaton rules | https://revenuecat-shipaton-2026.devpost.com/rules |
| Next Gen Award | https://www.shipaton.com/next-gen |
