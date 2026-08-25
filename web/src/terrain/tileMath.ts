// Standard slippy-map (Web Mercator / EPSG:3857) tile math.

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export function lngLatToTileFrac(lng: number, lat: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Northwest corner (lng, lat) of the given tile. */
export function tileToLngLat(x: number, y: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lng, lat];
}

/**
 * Tiles covering the given [west, south, east, north] bounds at zoom,
 * capped at maxTiles (returns the center-most tiles first if the bounds
 * would exceed the cap, so a huge/degenerate viewport degrades gracefully
 * instead of trying to fetch hundreds of DEM tiles at once).
 */
export function tilesForBounds(bounds: [number, number, number, number], zoom: number, maxTiles = 24): TileCoord[] {
  const [west, south, east, north] = bounds;
  const [xMinF, yMinF] = lngLatToTileFrac(west, north, zoom);
  const [xMaxF, yMaxF] = lngLatToTileFrac(east, south, zoom);

  const n = 2 ** zoom;
  const xMin = Math.max(0, Math.floor(xMinF));
  const xMax = Math.min(n - 1, Math.ceil(xMaxF));
  const yMin = Math.max(0, Math.floor(yMinF));
  const yMax = Math.min(n - 1, Math.ceil(yMaxF));

  const all: TileCoord[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      all.push({ z: zoom, x, y });
    }
  }

  if (all.length <= maxTiles) return all;

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  all.sort((a, b) => {
    const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
    const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
    return da - db;
  });
  return all.slice(0, maxTiles);
}

/**
 * Every tile covering the given bounds at zoom, nearest-to-center first —
 * same coverage/ordering logic as tilesForBounds, but with no cap. For
 * deliberate bulk region downloads (src/offline/), where the caller has
 * already sized the request and wants every tile, not a viewport-sized
 * sample of it.
 */
export function tilesForBoundsUnbounded(bounds: [number, number, number, number], zoom: number): TileCoord[] {
  return tilesForBounds(bounds, zoom, Infinity);
}

/** Total tile count for a bbox at a given zoom — same math as
 * tilesForBounds' coverage rectangle, without materializing the list.
 * Used for cheap up-front size estimates across a whole zoom range. */
export function tileCountForBounds(bounds: [number, number, number, number], zoom: number): number {
  const [west, south, east, north] = bounds;
  const [xMinF, yMinF] = lngLatToTileFrac(west, north, zoom);
  const [xMaxF, yMaxF] = lngLatToTileFrac(east, south, zoom);
  const n = 2 ** zoom;
  const xMin = Math.max(0, Math.floor(xMinF));
  const xMax = Math.min(n - 1, Math.ceil(xMaxF));
  const yMin = Math.max(0, Math.floor(yMinF));
  const yMax = Math.min(n - 1, Math.ceil(yMaxF));
  return Math.max(0, xMax - xMin + 1) * Math.max(0, yMax - yMin + 1);
}
