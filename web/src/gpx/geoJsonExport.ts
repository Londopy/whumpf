import type { LngLatElevation } from "../providers/types";
import type { GpxWaypoint } from "./gpxExport";

export interface GeoJsonExportOptions {
  routeName: string;
  trackPoints: LngLatElevation[];
  waypoints?: GpxWaypoint[];
}

/** Builds a GeoJSON FeatureCollection: one LineString feature for the
 * track, one Point feature per waypoint — the same data GPX export uses,
 * just in the other common trail-planning interchange format. */
export function buildGeoJson(opts: GeoJsonExportOptions): string {
  const lineFeature: GeoJSON.Feature = {
    type: "Feature",
    properties: { name: opts.routeName },
    geometry: {
      type: "LineString",
      coordinates: opts.trackPoints.map((p) => (p.elevation !== undefined ? [p.lng, p.lat, p.elevation] : [p.lng, p.lat])),
    },
  };
  const waypointFeatures: GeoJSON.Feature[] = (opts.waypoints ?? []).map((w) => ({
    type: "Feature",
    properties: { name: w.name },
    geometry: { type: "Point", coordinates: [w.point.lng, w.point.lat] as [number, number] },
  }));

  const collection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [lineFeature, ...waypointFeatures] };
  return JSON.stringify(collection, null, 2);
}

export function suggestGeoJsonFilename(routeName: string, distanceMeters: number): string {
  const safe = routeName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Route";
  const km = (distanceMeters / 1000).toFixed(1);
  return `${safe}_${km}km.geojson`;
}
