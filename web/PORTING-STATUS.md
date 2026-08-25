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

## Not done

**Phase 3 — the UI (~4,690 lines, 31 components).** All of `src/map/*.tsx`
plus `App.tsx`: layers menu, search bar, route planner, elevation profile
chart, offline download panel, settings, measure tool, info panels, and the
Liquid Glass theme. This is the single largest remaining chunk and it is
mechanical rather than architectural — DOM construction and event wiring
against controllers that already exist.

His 2,568 lines of CSS mostly transfer, but they are keyed to his component
structure, so they move with the components rather than ahead of them.

**Ski runs and lifts (`useSkiLayers`, 198 lines).** Blocked, and worth
understanding before you plan around it — see below.

**Contours (`useContours`, 162 lines).** Not ported, and probably should not
be. See below.

---

## Two findings worth acting on

### Ski layers are blocked on vector tiles

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

Option 2 also solves trail-snapping: the same endpoint can serve trail
linework, and `routeLayer.ts` already takes a `TrailGeometrySource`
interface waiting for exactly that.

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
