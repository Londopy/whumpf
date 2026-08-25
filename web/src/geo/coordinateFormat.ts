import type { LngLat } from "../providers/types";

export type CoordinateFormat = "dd" | "dms";

function toDms(value: number, positiveSuffix: string, negativeSuffix: string): string {
  const suffix = value >= 0 ? positiveSuffix : negativeSuffix;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}°${min}'${sec.toFixed(1)}"${suffix}`;
}

/** Formats a coordinate for display in either decimal-degrees or
 * degrees-minutes-seconds, per the user's Settings choice. */
export function formatCoordinate(point: LngLat, format: CoordinateFormat): string {
  if (format === "dms") {
    return `${toDms(point.lat, "N", "S")}, ${toDms(point.lng, "E", "W")}`;
  }
  const latSuffix = point.lat >= 0 ? "N" : "S";
  const lngSuffix = point.lng >= 0 ? "E" : "W";
  return `${Math.abs(point.lat).toFixed(5)}°${latSuffix}, ${Math.abs(point.lng).toFixed(5)}°${lngSuffix}`;
}

/** Plain "lat, lng" decimal string suitable for pasting elsewhere (maps
 * apps, GPS units) — always decimal regardless of the display format
 * setting, since that's the universally-parseable form. */
export function coordinateToClipboardText(point: LngLat): string {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}
