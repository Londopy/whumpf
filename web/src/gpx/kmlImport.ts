import type { LngLatElevation } from "../providers/types";
import type { ParsedGpx } from "./gpxImport";

/** Parses a KML "lng,lat[,ele] lng,lat[,ele] ..." coordinate string
 * (whitespace/newline-separated tuples, each comma-separated) — the format
 * every KML <coordinates> element uses regardless of which geometry it's
 * inside. */
function parseCoordinatesText(text: string): LngLatElevation[] {
  const points: LngLatElevation[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    const parts = tuple.split(",").map(Number);
    const [lng, lat, ele] = parts;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    points.push({ lng, lat, elevation: Number.isFinite(ele) ? ele : undefined });
  }
  return points;
}

/**
 * Parses plain KML (not KMZ — that's a zipped KML and would need an unzip
 * dependency this app doesn't otherwise need; deferred, see docs). Reads
 * every <coordinates> element under a <LineString> or <Point>, in document
 * order, and concatenates them — same "take what's there" approach as GPX/
 * GeoJSON import.
 */
export function parseKml(xmlText: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error("File is not valid KML/XML");

  const name = doc.querySelector("Document > name, Placemark > name")?.textContent ?? undefined;

  let points: LngLatElevation[] = [];
  const coordEls = Array.from(doc.getElementsByTagName("coordinates"));
  for (const el of coordEls) {
    if (!el.textContent) continue;
    points = points.concat(parseCoordinatesText(el.textContent));
  }

  if (points.length === 0) throw new Error("No coordinates found in file (note: zipped .kmz files aren't supported, only plain .kml)");
  return { name: name ?? undefined, points };
}
