import type { LngLatElevation, LngLat } from "../providers/types";

export interface GpxWaypoint {
  point: LngLat;
  name: string;
}

export interface GpxExportOptions {
  routeName: string;
  trackPoints: LngLatElevation[];
  waypoints?: GpxWaypoint[];
  createdAt?: Date;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function trkptXml(p: LngLatElevation): string {
  const ele = p.elevation !== undefined ? `<ele>${p.elevation.toFixed(1)}</ele>` : "";
  return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}</trkpt>`;
}

function wptXml(w: GpxWaypoint): string {
  return `  <wpt lat="${w.point.lat.toFixed(7)}" lon="${w.point.lng.toFixed(7)}"><name>${escapeXml(w.name)}</name></wpt>`;
}

/** Builds a standards-compliant GPX 1.1 document. Only includes fields we
 * actually have — no elevation tag when a point's elevation is unknown. */
export function buildGpxXml(opts: GpxExportOptions): string {
  const createdAt = opts.createdAt ?? new Date();
  const waypointsXml = (opts.waypoints ?? []).map(wptXml).join("\n");
  const trackPointsXml = opts.trackPoints.map(trkptXml).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Contour" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(opts.routeName)}</name>
    <time>${createdAt.toISOString()}</time>
  </metadata>
${waypointsXml}
  <trk>
    <name>${escapeXml(opts.routeName)}</name>
    <trkseg>
${trackPointsXml}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Sensible default filename, e.g. "Route_12.4km.gpx" — the native save
 * dialog lets the user rename it before saving. */
export function suggestGpxFilename(routeName: string, distanceMeters: number): string {
  const safe = routeName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Route";
  const km = (distanceMeters / 1000).toFixed(1);
  return `${safe}_${km}km.gpx`;
}
