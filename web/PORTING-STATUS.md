# Port status: contour-map → whumpf

Porting kiy-codes/contour-map (Tauri + React + MapLibre) into whumpf's
stack (browser + vanilla JS/TS + CesiumJS). This file tracks what has
landed, what is deliberately different, and what is left.

Everything below typechecks under `strict`. Run `npm run typecheck` in `web/`.

---

## Landed

**Phase 1 — engine-agnostic logic (~3,800 lines)**

Transferred near-verbatim; no map engine involved, so nothing to redesign.

| Area | What it does |
|---|---|
| `src/gpx/` | GPX 1.1, GeoJSON, KML import/export |
| `src/geo/` | Distance, area, DMS formatting, nearest-point-on-line |
| `src/routing/` | Elevation profile, difficulty estimate, time estimate, route reducer |
| `src/terrain/` | Marching-squares contour generation, tile math |
| `src/garmin/` | Validated Garmin course export |
| `src/cache/` | IndexedDB tile cache with LRU eviction |
| `src/offline/` | Offline region downloader, world overview seeding |
| `src/providers/` | Routing (ORS), geocoding, weather, avalanche, ski, terrain, satellite, topo |
| `src/net/` | Fetch timeout + error description |

Three files needed real work rather than a copy:

- **`gpx/gpxFileIO.ts`** — Tauri native dialogs → File System Access API,
  falling back to anchor-download + hidden file input on Firefox/Safari.
  Exported signatures unchanged, so every call site works as written.
- **`cache/tileCacheProtocol.ts`** — split the MapLibre `addProtocol`
  registration away from the cache-and-semaphore logic. The latter is
  engine-agnostic and kept as-is, including his 6-way concurrency cap.
- **`providers/ElevationProvider.ts`** — `queryTerrainElevation` →
  `globe.getHeight`, with an opt-in `sampleTerrainMostDetailed` path for
  profiles.

Four providers needed only their `@tauri-apps/plugin-http` import removed —
the browser's global `fetch` has the same signature.

**Phase 2 — Cesium layer rewrites (~1,000 lines)**

React hooks became controller classes. `useState` → a small `Observable`;
`useEffect` body and cleanup → `attach`/`detach`.

| Module | Replaces | Notable difference |
|---|---|---|
| `cesium/layerController.ts` | hook scaffolding | Shared lifecycle + observable state |
| `cesium/avalancheLayer.ts` | `useAvalancheLayer` | Cesium has no paint expressions, so rated/unrated styling is applied per-entity |
| `cesium/routeLayer.ts` | `useRouteLayer` | Cesium has no draggable marker, so drag is built on `ScreenSpaceEventHandler` with camera control suspended while held |
| `cesium/cachedImagery.ts` | `addProtocol` | `requestImage` override per provider |
| `cesium/weatherLayer.ts` | `useWeatherMapLayer` | Keeps the deliberate cache bypass for current conditions |
| `cesium/graticule.ts` | `useGraticule` | Polyline + label entities |
| `providers/OutdoorDataProvider.ts` | — | MapLibre `FilterSpecification` → plain predicate |

---

## Validation

Phase 2 was originally written against hand-written structural interfaces
(`CesiumViewerLike`, `CesiumApi`, and friends) rather than Cesium's own
typings. It compiled, but nothing had checked a single Cesium call against
the real API. Those interfaces are now gone -- every module imports from
`cesium` directly and typechecks against Cesium 1.144.

That surfaced one genuine bug and two type-correctness issues:

| Finding | Severity | Fix |
|---|---|---|
| `viewer.pick(...)` -- `pick` is on `Scene`, not `Viewer` | **Real bug.** Would have thrown on first click in both the avalanche and route layers | `viewer.scene.pick(...)` |
| Entity graphics take `Property` objects, not raw values | Cosmetic -- Cesium's setters coerce at runtime, so it would have worked | Explicit `ColorMaterialProperty` / `ConstantProperty` |
| `entity.position` takes a `PositionProperty` | Same | Explicit `ConstantPositionProperty` |

Separately, `index.html` pulled Cesium's widget CSS from a CDN pinned to
1.118 while npm resolved `^1.118` to **1.144** -- so the stylesheet and the
engine could drift apart on any fresh install. The CSS now comes from the
installed package and cannot disagree with it.

### Runtime checks

Typechecking proves shape, not behaviour, so the ported logic is also
executed: `npm run smoke` in `web/` runs 12 assertions covering geodesy
against an independently computed great-circle distance, a GPX
export/re-import round trip, resampling, difficulty monotonicity, and the
`Observable` change semantics (including the bail-on-identical-value
behaviour that mirrors React's). All pass.

One testability note that came out of it: `parseGpx` uses the browser's
`DOMParser`, so running it under Node needs a DOM shim (`linkedom`, wired
into the smoke test). Worth knowing before you put any of this in CI.

**Cross-boundary contract.** The Python endpoint and the TypeScript client
agree on a payload shape by convention -- there is no shared schema, so
nothing would catch it if one side drifted. `npm run contract` feeds a real
captured Flask response through the real client parsers and asserts the
result is usable: coordinate axis order, difficulty preservation, lift-type
inference, and that run geometry measures to a plausible length. 13 checks.

**Headless UI checks.** `LayersPanel` and `FeatureInfoPanel` are ordinary
DOM construction, so they run against linkedom without a browser. 20 checks
cover toggle-to-controller plumbing, the status line in every state, the
elevation dash-not-zero rule, and HTML-escaping of OSM names (which are
user-supplied data).

Run everything with `npm run check` in `web/` — typecheck, then 19 smoke,
13 contract, and 20 UI checks — plus `pytest -q` at the repo root for 44
more.

**Still unexecuted:** everything in `src/cesium/` needs WebGL and a real
globe, so none of it has run. The API calls are now verified against
Cesium's typings, which is a much stronger claim than before, but it is not
the same as having watched it draw. That is what the vertical slice is for.

---

## Not done

**Phase 3 — most of the UI.** A first slice is now wired (see "Runnable
slice" below): layer toggles and a feature info panel, grafted into whumpf's
existing side panel.

Still unported, roughly 4,000 lines: search bar, route planner, elevation
profile chart, offline download panel and regions manager, measure tool,
settings, place info, and the Liquid Glass theme.

Note this is deliberately **not** a wholesale port of his 31 components.
whumpf already has a panel, a mode switcher, and an AOI selector; his
components assume his app shell. Importing that shell wholesale would give
you two competing UIs on one page. Each remaining component is worth
porting as capability re-expressed in this app's idiom, the way the layers
panel was — not as a file copy.

**Ski runs and lifts (`useSkiLayers`, 198 lines).** Blocked, and worth
understanding before you plan around it — see below.

**Contours (`useContours`, 162 lines).** Not ported, and probably should not
be. See below.

---

## Runnable slice

The app now actually does something with the ported code. Start the API and
the dev server:

```bash
flask --app api.app run --debug   # terminal 1
cd web && npm run dev             # terminal 2
```

The side panel gains a **Layers** section with four toggles:

| Toggle | What it does |
|---|---|
| Ski runs | OSM piste geometry for the AOI, coloured by tagged difficulty, clickable |
| Lifts | Aerialways, typed (gondola/chair/drag/carpet) and clickable |
| Snap routes to trails | Loads approach tracks so route waypoints snap to them |
| Lat/lng grid | Graticule with labels |

Clicking a run or lift opens an info panel with length, top/bottom
elevation, and vertical drop. Elevation is sampled from the loaded terrain
and renders as `—` when terrain has not loaded, never as `0 m`. On an
avalanche tool a fabricated elevation is worse than a blank.

Toggle state survives an AOI change: if runs were on for one range, they
stay on for the next.

**This is the part I could not verify.** Everything in `src/cesium/` needs
WebGL and a real globe. The API calls are checked against Cesium's typings
and the UI is checked headlessly, but nothing has drawn a pixel. If a layer
misbehaves, the browser console is the ground truth and the status line
beside each toggle (`loading…` / a count / `none here` / `failed`) is the
first place to look.

---

## Two findings worth acting on

### Ski layers: unblocked (option 2, built)

His ski runs and lifts come from an **OpenSkiMap vector tileset**, added as
`type: "vector"` and styled with MapLibre filter expressions. Cesium renders
imagery as rasters and has no vector-tile pipeline, so there is no direct
equivalent. Same root cause blocks waypoint trail-snapping, which read
trail linework out of already-loaded OSM vector tiles.

For a ski app this is not a minor gap. Four ways out, roughly by cost:

1. **Raster ski overlay.** Serve pre-rendered run/lift tiles instead. Cheap,
   works today via `cachedImagery.ts` — but you lose click-to-inspect a run,
   difficulty filtering, and label control, since there are no features to
   query.
2. **GeoJSON for the current AOI.** whumpf is already AOI-scoped
   (`config/aoi/*.toml`), unlike his world-wide app. Fetch runs and lifts
   for one AOI as GeoJSON from your Flask API and load them as entities —
   full interactivity, and it fits your architecture better than his did.
   **This is the one I would do.**
3. **Decode vector tiles client-side.** A `.mvt` parser feeding Cesium
   entities. Full generality, meaningful work, and you would be building
   what MapLibre already gives away.
4. **Drop ski layers.** Defensible if the avalanche overlay is the product
   and resort mapping was never the point.

**Option 2 is now built.** New pieces:

| Piece | What it is |
|---|---|
| `api/features/schema.py` | Normalized feature/collection types. Emits *OpenSkiMap's* property names (`difficulty`, `color`, `name_and_type`, `status`) so the client parsers work unchanged |
| `api/features/base.py` | Adapter ABC + registry + fixture fallback -- same shape as `api/bulletin/base.py` |
| `api/features/overpass.py` | OSM via Overpass, one AOI bbox per query |
| `GET /api/aoi/<slug>/features` | GeoJSON, `?kinds=runs,lifts,trails`, cached 24h |
| `web/src/providers/AoiFeatureProvider.ts` | Client |
| `web/src/cesium/skiLayer.ts` | Runs and lifts as clickable, difficulty-filterable polylines |
| `web/src/cesium/aoiTrailSource.ts` | The `TrailGeometrySource` implementation -- snapping now works |

Design notes worth knowing:

- **Overpass is shared and rate-limited.** Fetched once per AOI and cached
  for a day server-side. It is not a per-camera-move query and must not
  become one.
- **An AOI with no features returns an empty collection, not a 404.** Absent
  features are a normal state; a failure banner over an optional overlay is
  worse than nothing.
- **`?kinds=` rejects typos with a 400** rather than silently returning
  empty -- an empty result and a misspelled parameter look identical, and
  that is miserable to debug.
- **Untagged difficulty is `"unknown"`, never guessed.** Same rule the
  desktop client followed.
- **Trails exclude `highway=footway`**, which in OSM is overwhelmingly urban
  pavement and buries the actual approach tracks.

Snapping is fetched up front rather than per click, because `linesNear` has
to be synchronous (the route layer calls it inside a click handler). Before
`load()` resolves, waypoints land where you clicked -- the same degradation
the original had when no trail was loaded nearby.

### Contours: the port makes this *easier*

His 162-line `useContours` plus marching-squares implementation exists
because MapLibre cannot draw elevation contours from a DEM — he had to
decode DEM tiles and generate the isolines himself in a worker.

Cesium can do this natively on the globe material
(`createElevationBandMaterial`, or a contour material on `globe.material`).
Porting his implementation would be reimplementing something the engine
already provides. The marching-squares code is already ported and still
useful if you want contours as real geometry (to export, snap to, or
measure), but for *display* use the Cesium material.

Roughly the only place the stack change wins outright. Worth telling him.

---

## Running it

```bash
cd web
npm install
npm run typecheck    # all ported modules, strict
npm run build
npm run dev          # expects the Flask API on :5000, proxied at /api
```

`vite build` currently reports only a handful of modules, which is correct
and temporary: the ported modules are library code that nothing imports yet,
so Vite tree-shakes them out. They come into the bundle as Phase 3 wires
them to UI. `npm run typecheck` covers all of `src/` regardless.

## Attribution

Ported code is kiy-codes' work. Both port commits carry
`Co-authored-by: PickleRickKid <kiyandayal@gmail.com>`. contour-map ships no
LICENSE file, so his written agreement to contribute under whumpf's MIT
licence is still outstanding — see `MERGE-RUNBOOK.md`.
