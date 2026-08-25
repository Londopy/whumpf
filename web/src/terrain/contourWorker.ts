/// <reference lib="webworker" />
import { decodeTerrarium } from "../providers/TerrainProvider";
import { tileToLngLat, type TileCoord } from "./tileMath";
import { extractIsolineSegments } from "./marchingSquares";
import { stitchSegments } from "./stitchSegments";

/** Grid downsample factor: sample every Nth DEM pixel per tile. Cuts cell
 * (and therefore raw segment) count by STRIDE^2 with minimal visible loss
 * of contour detail — real cartographic contours aren't pixel-precise. */
const STRIDE = 2;

export interface ContourWorkerRequest {
  requestId: string;
  tiles: TileCoord[];
  urlTemplate: string;
  tileSize: number;
  minor: number;
  majorMultiple: number;
}

export interface ContourFeatureProperties {
  elevation: number;
  major: boolean;
}

export interface ContourWorkerResponse {
  requestId: string;
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.LineString, ContourFeatureProperties>;
}

interface DemGrid {
  values: Float32Array;
  gridSize: number;
}

async function decodeTile(url: string, size: number): Promise<DemGrid | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const gridSize = Math.floor((size - 1) / STRIDE) + 1;
  const values = new Float32Array(gridSize * gridSize);
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const px = Math.min(gx * STRIDE, size - 1);
      const py = Math.min(gy * STRIDE, size - 1);
      const i = py * size + px;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      values[gy * gridSize + gx] = decodeTerrarium(r, g, b);
    }
  }
  return { values, gridSize };
}

function pixelToLngLat(tile: TileCoord, gx: number, gy: number, gridSize: number): [number, number] {
  const size = (gridSize - 1) * STRIDE;
  return tileToLngLat(tile.x + (gx * STRIDE) / size, tile.y + (gy * STRIDE) / size, tile.z);
}

async function processTile(
  tile: TileCoord,
  urlTemplate: string,
  size: number,
  minor: number,
  majorMultiple: number,
): Promise<GeoJSON.Feature<GeoJSON.LineString, ContourFeatureProperties>[]> {
  const url = urlTemplate.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
  const dem = await decodeTile(url, size);
  if (!dem) return [];
  const { values: grid, gridSize } = dem;

  let min = Infinity;
  let max = -Infinity;
  for (const v of grid) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || max - min < minor) return [];

  const features: GeoJSON.Feature<GeoJSON.LineString, ContourFeatureProperties>[] = [];
  const firstThreshold = Math.ceil(min / minor) * minor;
  for (let elevation = firstThreshold; elevation <= max; elevation += minor) {
    const segments = extractIsolineSegments(grid, gridSize, gridSize, elevation);
    if (segments.length === 0) continue;
    const major = Math.round(elevation / minor) % majorMultiple === 0;
    for (const chain of stitchSegments(segments)) {
      const coordinates = chain.map(([gx, gy]) => pixelToLngLat(tile, gx, gy, gridSize));
      features.push({
        type: "Feature",
        properties: { elevation, major },
        geometry: { type: "LineString", coordinates },
      });
    }
  }
  return features;
}

self.onmessage = async (event: MessageEvent<ContourWorkerRequest>) => {
  const { requestId, tiles, urlTemplate, tileSize, minor, majorMultiple } = event.data;

  const results = await Promise.all(tiles.map((t) => processTile(t, urlTemplate, tileSize, minor, majorMultiple)));
  const featureCollection: GeoJSON.FeatureCollection<GeoJSON.LineString, ContourFeatureProperties> = {
    type: "FeatureCollection",
    features: results.flat(),
  };

  const response: ContourWorkerResponse = { requestId, featureCollection };
  (self as unknown as Worker).postMessage(response);
};
