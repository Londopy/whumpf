export interface ContourLevel {
  /** Interval in meters between minor contour lines. */
  minor: number;
  /** Every Nth minor line is drawn as a thicker, labeled "major" line. */
  majorMultiple: number;
  /** Source DEM zoom to fetch tiles at for this map zoom. */
  sourceZoom: number;
}

/**
 * Returns the contour interval to use at a given map zoom, or null below
 * the zoom where contours would just be visual clutter (per spec: "low
 * visual clutter", contours are mainly useful once you're at hiking scale).
 */
export function contourLevelForZoom(zoom: number): ContourLevel | null {
  if (zoom < 11) return null;
  if (zoom < 12.5) return { minor: 100, majorMultiple: 5, sourceZoom: 11 };
  if (zoom < 14) return { minor: 50, majorMultiple: 5, sourceZoom: 12 };
  return { minor: 20, majorMultiple: 5, sourceZoom: 13 };
}
