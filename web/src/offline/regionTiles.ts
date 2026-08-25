// Resolves which tile URLs an offline region needs, per layer, and gives a
// cheap up-front size estimate — pure data/network logic, no React, no
// storage-schema knowledge (that's persistentCache.ts). The download job
// engine (downloadManager.ts) is the only consumer that turns this list
// into an actual fetch queue.
import { OpenFreeMapProvider } from "../providers/MapProvider";
import { AwsTerrariumTerrainProvider } from "../providers/TerrainProvider";
import { EsriWorldImageryProvider } from "../providers/SatelliteProvider";
import { OpenTopoMapProvider } from "../providers/TopoProvider";
import { OpenSkiMapProvider } from "../providers/SkiDataProvider";
import { tileCacheKey } from "../cache/tileCacheProtocol";
import { cacheGetBytes, cacheGetJson, cachePutJson } from "../cache/persistentCache";
import { tileCountForBounds, tilesForBoundsUnbounded } from "../terrain/tileMath";

export type OfflineLayerId = "standard" | "satellite" | "terrain" | "topo" | "ski" | "waymarked";
export type Bbox = [west: number, south: number, east: number, north: number];

export interface OfflineLayerMeta {
  id: OfflineLayerId;
  label: string;
  /** Shown in the layer picker — what selecting this layer actually gets you. */
  description: string;
  needsEsriKey?: boolean;
}

export const OFFLINE_LAYERS: OfflineLayerMeta[] = [
  { id: "standard", label: "Standard map", description: "Roads, places, boundaries — the base map style" },
  { id: "satellite", label: "Satellite imagery", description: "Esri aerial imagery", needsEsriKey: true },
  { id: "terrain", label: "Terrain", description: "3D elevation + offline contour lines" },
  { id: "topo", label: "Topo shading", description: "Hillshaded 2D terrain overlay" },
  { id: "ski", label: "Ski runs & lifts", description: "OpenSkiMap piste/lift data" },
  { id: "waymarked", label: "Long-distance trails", description: "Waymarked Trails hiking overlay" },
];

/** Hard ceiling on a single region's tile count — keeps a mis-drawn "whole
 * continent at max zoom" selection from turning into an unbounded download
 * against free community tile services. The UI warns well before this and
 * disables the start button past it; the download job also refuses as a
 * defense in depth. */
export const MAX_REGION_TILES = 20_000;

const mapProvider = new OpenFreeMapProvider("liberty");
const terrainProvider = new AwsTerrariumTerrainProvider();
const satelliteProvider = new EsriWorldImageryProvider();
const topoProvider = new OpenTopoMapProvider();
const skiProvider = new OpenSkiMapProvider();
const WAYMARKED_TEMPLATE = "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png";
const WAYMARKED_MAX_ZOOM = 18;

interface TileJson {
  tiles?: string[];
  maxzoom?: number;
}

interface StyleJson {
  sprite?: string;
}

async function fetchJsonThroughCache<T>(url: string): Promise<T | null> {
  const key = tileCacheKey(url);
  const cached = await cacheGetJson<T>(key);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as T;
    await cachePutJson(key, json);
    return json;
  } catch {
    return null;
  }
}

let standardTemplateCache: { template: string; maxzoom: number } | null = null;

/** Resolves the *current* vector tile URL template for the Standard base
 * style. The upstream TileJSON's tile URL is date-versioned (confirmed
 * live: ".../planet/20260816_080001_pt/{z}/{x}/{y}.pbf") and changes over
 * time as OpenFreeMap refreshes its planet extract — this must never be
 * hardcoded, only resolved live, through the same cache the running map
 * itself populates when it loads the style. */
export async function resolveStandardTileTemplate(): Promise<{ template: string; maxzoom: number } | null> {
  if (standardTemplateCache) return standardTemplateCache;
  const json = await fetchJsonThroughCache<TileJson>("https://tiles.openfreemap.org/planet");
  if (!json?.tiles?.[0]) return null;
  standardTemplateCache = { template: json.tiles[0], maxzoom: json.maxzoom ?? 14 };
  return standardTemplateCache;
}

/** The style JSON, sprite JSON, and sprite images (1x/2x) — fetched once
 * per job, not once per tile, so the Standard layer renders with its real
 * icons/styling offline. The sprite URL is read from the live style JSON
 * rather than hardcoded, same reasoning as the tile template above. */
export async function standardAuxiliaryUrls(): Promise<string[]> {
  const styleUrl = mapProvider.getStyle();
  const urls = [styleUrl];
  const style = await fetchJsonThroughCache<StyleJson>(styleUrl);
  if (style?.sprite) {
    urls.push(`${style.sprite}.json`, `${style.sprite}.png`, `${style.sprite}@2x.json`, `${style.sprite}@2x.png`);
  }
  return urls;
}

export async function layerMaxZoom(layer: OfflineLayerId): Promise<number> {
  switch (layer) {
    case "standard":
      return (await resolveStandardTileTemplate())?.maxzoom ?? 14;
    case "satellite":
      return satelliteProvider.maxZoom;
    case "terrain":
      return terrainProvider.maxZoom;
    case "topo":
      return topoProvider.maxZoom;
    case "ski":
      return skiProvider.maxzoom;
    case "waymarked":
      return WAYMARKED_MAX_ZOOM;
  }
}

/** Raw tile URL templates for a layer — 1 entry normally, 3 for topo (its
 * three OpenTopoMap mirror subdomains). Empty for satellite without an Esri
 * key, or for standard if the live TileJSON couldn't be resolved (offline
 * with nothing cached yet — caller should surface that rather than silently
 * produce zero tiles). */
async function templatesForLayer(layer: OfflineLayerId, esriApiKey?: string): Promise<string[]> {
  switch (layer) {
    case "standard": {
      const resolved = await resolveStandardTileTemplate();
      return resolved ? [resolved.template] : [];
    }
    case "satellite":
      return esriApiKey ? [satelliteProvider.getTileUrlTemplate(esriApiKey)] : [];
    case "terrain":
      return [terrainProvider.getTileUrlTemplate()];
    case "topo":
      return topoProvider.tileUrlTemplates;
    case "ski":
      return [skiProvider.tileUrlTemplate];
    case "waymarked":
      return [WAYMARKED_TEMPLATE];
  }
}

function fillTemplate(template: string, x: number, y: number, z: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export interface OfflineTileRequest {
  url: string;
  layer: OfflineLayerId;
  z: number;
}

/** Every tile URL needed for one layer across a whole zoom range, clamped
 * to that layer's own real max zoom (never requests a zoom a provider
 * doesn't serve, even if the user's slider goes higher). Ordered lowest
 * zoom first, matching the "prioritise lower-zoom tiles" requirement —
 * within a zoom level, tilesForBoundsUnbounded's own nearest-center-first
 * order (inherited from tilesForBounds) covers "visible tiles first" for a
 * region centered on the current view. */
export async function tilesForLayer(
  layer: OfflineLayerId,
  bbox: Bbox,
  zoomRange: [number, number],
  esriApiKey?: string,
): Promise<OfflineTileRequest[]> {
  const maxAvailable = await layerMaxZoom(layer);
  const [reqMin, reqMax] = zoomRange;
  const hiZoom = Math.min(reqMax, maxAvailable);
  if (reqMin > hiZoom) return [];

  const templates = await templatesForLayer(layer, esriApiKey);
  if (templates.length === 0) return [];

  const requests: OfflineTileRequest[] = [];
  for (let z = reqMin; z <= hiZoom; z++) {
    const coords = tilesForBoundsUnbounded(bbox, z);
    for (const { x, y } of coords) {
      for (const template of templates) {
        requests.push({ url: fillTemplate(template, x, y, z), layer, z });
      }
    }
  }
  return requests;
}

export interface RegionSizeEstimate {
  tileCounts: Partial<Record<OfflineLayerId, number>>;
  totalTiles: number;
  estimatedBytes: number;
  /** True if MAX_REGION_TILES was exceeded — caller should block starting. */
  exceedsLimit: boolean;
}

const SAMPLE_TILES_PER_LAYER = 4;
const FALLBACK_AVG_TILE_BYTES = 25 * 1024;

/** Exact tile counts (cheap arithmetic) plus a size estimate refined by
 * sampling a handful of real tiles per layer at the coarsest requested
 * zoom — tile sizes vary wildly by layer (a few KB of vector data vs a
 * ~40KB DEM PNG vs a ~50KB satellite JPEG), so a single flat guess across
 * layers would be misleading. Shown to the user before they commit to a
 * download. */
export async function estimateRegionSize(
  bbox: Bbox,
  zoomRange: [number, number],
  layers: OfflineLayerId[],
  esriApiKey?: string,
): Promise<RegionSizeEstimate> {
  const tileCounts: Partial<Record<OfflineLayerId, number>> = {};
  let totalTiles = 0;
  let sampledBytes = 0;
  let sampledCount = 0;
  const [reqMin, reqMax] = zoomRange;

  for (const layer of layers) {
    const maxAvailable = await layerMaxZoom(layer);
    const hiZoom = Math.min(reqMax, maxAvailable);
    const templates = await templatesForLayer(layer, esriApiKey);
    const mirrors = templates.length || 1;

    let count = 0;
    for (let z = reqMin; z <= hiZoom; z++) {
      count += tileCountForBounds(bbox, z) * mirrors;
    }
    tileCounts[layer] = count;
    totalTiles += count;

    if (templates.length > 0 && count > 0 && totalTiles <= MAX_REGION_TILES) {
      const sampleCoords = tilesForBoundsUnbounded(bbox, reqMin).slice(0, SAMPLE_TILES_PER_LAYER);
      for (const { x, y } of sampleCoords) {
        const url = fillTemplate(templates[0], x, y, reqMin);
        try {
          const cached = await cacheGetBytes(tileCacheKey(url));
          if (cached) {
            sampledBytes += cached.bytes.byteLength;
            sampledCount++;
            continue;
          }
          const res = await fetch(url);
          if (res.ok) {
            sampledBytes += (await res.arrayBuffer()).byteLength;
            sampledCount++;
          }
        } catch {
          // Sampling is best-effort — worst case, the fallback average below applies.
        }
      }
    }
  }

  const avgBytesPerTile = sampledCount > 0 ? sampledBytes / sampledCount : FALLBACK_AVG_TILE_BYTES;
  return {
    tileCounts,
    totalTiles,
    estimatedBytes: Math.round(totalTiles * avgBytesPerTile),
    exceedsLimit: totalTiles > MAX_REGION_TILES,
  };
}
