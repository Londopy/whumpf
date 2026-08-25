/** Import surface check: forces every ported module into the bundle so the
 * build proves they resolve and compile together, not just in isolation.
 * Not wired to the UI yet -- Phase 3 replaces this with real call sites. */
export * as avalancheLayer from "./cesium/avalancheLayer";
export * as routeLayer from "./cesium/routeLayer";
export * as cachedImagery from "./cesium/cachedImagery";
export * as weatherLayer from "./cesium/weatherLayer";
export * as graticule from "./cesium/graticule";
export * as layerController from "./cesium/layerController";
export * as gpxExport from "./gpx/gpxExport";
export * as gpxImport from "./gpx/gpxImport";
export * as kmlImport from "./gpx/kmlImport";
export * as distance from "./geo/distance";
export * as elevationProfile from "./routing/elevationProfile";
export * as routeDifficulty from "./routing/routeDifficulty";
export * as garminCourse from "./garmin/garminCourse";
export * as offlineRegions from "./offline/regionTiles";
export * as skiLayer from "./cesium/skiLayer";
export * as aoiTrailSource from "./cesium/aoiTrailSource";
export * as aoiFeatureProvider from "./providers/AoiFeatureProvider";
