import type { LngLatElevation } from "../providers/types";

export interface ParsedGpx {
  name?: string;
  points: LngLatElevation[];
}

function parsePoints(el: Element, pointTag: string): LngLatElevation[] {
  const points: LngLatElevation[] = [];
  for (const pt of Array.from(el.getElementsByTagName(pointTag))) {
    const lat = Number(pt.getAttribute("lat"));
    const lng = Number(pt.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const eleEl = pt.getElementsByTagName("ele")[0];
    const elevation = eleEl?.textContent ? Number(eleEl.textContent) : undefined;
    points.push({ lat, lng, elevation: Number.isFinite(elevation) ? elevation : undefined });
  }
  return points;
}

/**
 * Parses a GPX 1.1 (or 1.0) document. Prefers track points (<trk>/<trkseg>/
 * <trkpt>, concatenating all segments), falls back to a <rte>'s <rtept>
 * list, then to standalone <wpt> points as a last resort — covering the
 * three shapes real-world GPX files commonly come in. Never invents an
 * elevation for a point that doesn't have an <ele> child.
 */
export function parseGpx(xmlText: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error("File is not valid GPX/XML");

  const name = doc.querySelector("metadata > name")?.textContent ?? doc.querySelector("trk > name")?.textContent ?? undefined;

  let points: LngLatElevation[] = [];
  const tracks = Array.from(doc.getElementsByTagName("trk"));
  for (const trk of tracks) {
    points = points.concat(parsePoints(trk, "trkpt"));
  }
  if (points.length === 0) {
    const routes = Array.from(doc.getElementsByTagName("rte"));
    for (const rte of routes) {
      points = points.concat(parsePoints(rte, "rtept"));
    }
  }
  if (points.length === 0) {
    points = parsePoints(doc.documentElement, "wpt");
  }
  if (points.length === 0) throw new Error("No track, route, or waypoint coordinates found in file");

  return { name: name ?? undefined, points };
}
