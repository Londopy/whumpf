import type { LngLat } from "../providers/types";

// Local equirectangular approximation — accurate enough at snap-to-trail
// scale (tens of meters) without a full geodesic projection.
const METERS_PER_DEG_LAT = 110540;

function metersPerDegLng(atLat: number): number {
  return 111320 * Math.cos((atLat * Math.PI) / 180);
}

function toLocalMeters(p: LngLat, origin: LngLat): [number, number] {
  return [(p.lng - origin.lng) * metersPerDegLng(origin.lat), (p.lat - origin.lat) * METERS_PER_DEG_LAT];
}

function fromLocalMeters(xy: [number, number], origin: LngLat): LngLat {
  return {
    lng: origin.lng + xy[0] / metersPerDegLng(origin.lat),
    lat: origin.lat + xy[1] / METERS_PER_DEG_LAT,
  };
}

/** Closest point on segment a-b to point p, all in local planar meters. */
function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return a;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * abx, a[1] + t * aby];
}

/**
 * Nearest point to `click` on any of the given polylines, in meters. Used
 * to snap a new/dragged route waypoint onto the trail network rather than
 * leaving it floating a few meters off to the side.
 */
export function nearestPointOnLines(click: LngLat, lines: LngLat[][]): { point: LngLat; distanceMeters: number } | null {
  let best: { point: [number, number]; distSq: number } | null = null;
  const clickLocal: [number, number] = [0, 0]; // click is the projection origin

  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = toLocalMeters(line[i - 1], click);
      const b = toLocalMeters(line[i], click);
      const candidate = nearestOnSegment(clickLocal, a, b);
      const dx = candidate[0] - clickLocal[0];
      const dy = candidate[1] - clickLocal[1];
      const distSq = dx * dx + dy * dy;
      if (!best || distSq < best.distSq) best = { point: candidate, distSq };
    }
  }

  if (!best) return null;
  return { point: fromLocalMeters(best.point, click), distanceMeters: Math.sqrt(best.distSq) };
}
