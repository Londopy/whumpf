import type { LngLat } from "../providers/types";

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * Area of a polygon in square meters, via the shoelace formula on a
 * locally-flattened equirectangular projection (degrees -> meters, scaled
 * by cos(latitude) for longitude) — the same flat-earth approximation
 * already used for the GPS accuracy circle (see geo/distance.ts's
 * circleRing). Accurate enough for the polygon sizes this tool is meant
 * for (measuring a field, a lake, a small area on a hike); not intended
 * for anything approaching country-scale, where the flat approximation
 * breaks down.
 */
export function polygonAreaSqMeters(points: LngLat[]): number {
  if (points.length < 3) return 0;
  const originLatRad = (points[0].lat * Math.PI) / 180;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(originLatRad);

  const xy = points.map((p) => ({ x: p.lng * metersPerDegLng, y: p.lat * METERS_PER_DEG_LAT }));
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    sum += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return Math.abs(sum) / 2;
}
