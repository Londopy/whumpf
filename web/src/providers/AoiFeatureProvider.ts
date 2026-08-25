/** Ski runs, lifts, and trails for one AOI, from whumpf's own API.
 *
 * This is the replacement for OpenSkiMap vector tiles. The desktop client
 * read runs and lifts out of a world-wide `.pbf` tileset; Cesium has no
 * vector-tile pipeline, and whumpf is AOI-scoped anyway, so the server
 * fetches one bounding box from OSM and hands back GeoJSON.
 *
 * The server deliberately emits OpenSkiMap's property names, so
 * `parseSkiRunProperties` / `parseSkiLiftProperties` in SkiDataProvider.ts
 * work on these features unchanged.
 */
import type { AttributionEntry, LngLat } from "./types";
import { withTimeout } from "../net/fetchTimeout";

export type FeatureKind = "runs" | "lifts" | "trails";

export interface AoiFeature {
  id: string;
  kind: FeatureKind;
  geometry: LngLat[];
  properties: Record<string, unknown>;
}

export interface AoiFeatureCollection {
  aoi: string;
  source: string;
  attribution: AttributionEntry;
  isFixture: boolean;
  counts: Partial<Record<FeatureKind, number>>;
  features: AoiFeature[];
}

interface RawFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: [number, number][] };
  properties?: Record<string, unknown>;
}

interface RawCollection {
  aoi?: string;
  source?: string;
  attribution?: string;
  is_fixture?: boolean;
  counts?: Record<string, number>;
  features?: RawFeature[];
}

const REQUEST_TIMEOUT_MS = 20_000;

export class AoiFeatureProvider {
  constructor(private readonly baseUrl: string = "") {}

  /** Fetches features for an AOI. Omit `kinds` for everything.
   *
   * The server caches these for a day, so calling this once per AOI on load
   * is the intended usage -- not per camera move. */
  async getFeatures(
    aoiSlug: string,
    kinds?: FeatureKind[],
    signal?: AbortSignal,
  ): Promise<AoiFeatureCollection> {
    const query = kinds && kinds.length > 0 ? `?kinds=${kinds.join(",")}` : "";
    const url = `${this.baseUrl}/api/aoi/${encodeURIComponent(aoiSlug)}/features${query}`;

    // withTimeout composes the caller's signal with a timeout and returns
    // the combined signal -- same helper the other providers use.
    const response = await fetch(url, { signal: withTimeout(signal, REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Features request failed: ${response.status}`);
    }
    return normalizeCollection((await response.json()) as RawCollection);
  }
}

function normalizeCollection(raw: RawCollection): AoiFeatureCollection {
  const features: AoiFeature[] = [];
  for (const f of raw.features ?? []) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const kind = f.properties?.kind;
    if (kind !== "runs" && kind !== "lifts" && kind !== "trails") continue;
    features.push({
      id: f.id ?? String(f.properties?.id ?? ""),
      kind,
      // GeoJSON is [lng, lat]; the rest of the app uses {lng, lat}.
      geometry: coords.map(([lng, lat]) => ({ lng, lat })),
      properties: f.properties ?? {},
    });
  }
  return {
    aoi: raw.aoi ?? "",
    source: raw.source ?? "unknown",
    attribution: { html: raw.attribution ?? "" },
    isFixture: raw.is_fixture === true,
    counts: (raw.counts ?? {}) as Partial<Record<FeatureKind, number>>,
    features,
  };
}
