import type { LngLatElevation } from "../providers/types";
import type { ParsedGpx } from "./gpxImport";

function coordToPoint(c: number[]): LngLatElevation | null {
  if (c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { lng: c[0], lat: c[1], elevation: Number.isFinite(c[2]) ? c[2] : undefined };
}

function extractFromGeometry(geom: GeoJSON.Geometry): LngLatElevation[] {
  switch (geom.type) {
    case "Point": {
      const p = coordToPoint(geom.coordinates);
      return p ? [p] : [];
    }
    case "LineString":
      return geom.coordinates.map(coordToPoint).filter((p): p is LngLatElevation => p !== null);
    case "MultiLineString":
      return geom.coordinates.flatMap((line) => line.map(coordToPoint).filter((p): p is LngLatElevation => p !== null));
    case "MultiPoint":
      return geom.coordinates.map(coordToPoint).filter((p): p is LngLatElevation => p !== null);
    case "GeometryCollection":
      return geom.geometries.flatMap(extractFromGeometry);
    default:
      return [];
  }
}

/**
 * Parses a GeoJSON Feature/FeatureCollection/bare-geometry document into
 * points, mirroring parseGpx's shape so both feed the same import pipeline.
 * Concatenates every LineString/MultiLineString/Point found — same
 * "take what's there" approach as GPX's track/route/waypoint fallback
 * chain, since real-world exported files vary in exactly what they contain.
 */
export function parseGeoJson(jsonText: string): ParsedGpx {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("File is not valid JSON/GeoJSON");
  }
  if (typeof data !== "object" || data === null || !("type" in data)) {
    throw new Error("Not a recognizable GeoJSON document");
  }

  const doc = data as GeoJSON.GeoJSON;
  let points: LngLatElevation[] = [];
  let name: string | undefined;

  if (doc.type === "FeatureCollection") {
    for (const feature of doc.features) {
      if (feature.geometry) points = points.concat(extractFromGeometry(feature.geometry));
      if (!name && typeof feature.properties?.name === "string") name = feature.properties.name;
    }
  } else if (doc.type === "Feature") {
    if (doc.geometry) points = extractFromGeometry(doc.geometry);
    if (typeof doc.properties?.name === "string") name = doc.properties.name;
  } else {
    points = extractFromGeometry(doc);
  }

  if (points.length === 0) throw new Error("No point/line coordinates found in file");
  return { name, points };
}
