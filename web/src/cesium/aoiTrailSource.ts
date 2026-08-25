/** Trail geometry for waypoint snapping, from the AOI features endpoint.
 *
 * Fills the `TrailGeometrySource` hole left in routeLayer.ts. In the desktop
 * client, snapping read trail linework out of already-loaded OSM vector
 * tiles via `map.querySourceFeatures` -- free, because the renderer had the
 * tiles anyway. Cesium holds no vector features, so trails are fetched once
 * for the AOI and kept in memory.
 *
 * `linesNear` is synchronous because the route layer calls it inside a click
 * handler. Loading is therefore explicit and up front: call `load()` when
 * the AOI changes. Before that resolves, snapping returns nothing and
 * waypoints land where the user clicked -- the same graceful degradation the
 * original had whenever no trail happened to be loaded nearby.
 */
import type { LngLat } from "../providers/types";
import type { AoiFeatureProvider } from "../providers/AoiFeatureProvider";
import type { TrailGeometrySource } from "./routeLayer";

/** Half-width of the candidate window, in degrees. Snapping only cares about
 * trails within ~35 m, so this is generous -- it exists to keep the
 * per-click distance maths off the whole AOI, not to be precise. At 45°
 * latitude 0.01° is roughly 800 m. */
const NEAR_WINDOW_DEG = 0.01;

export class AoiTrailSource implements TrailGeometrySource {
  private lines: LngLat[][] = [];
  private loadedAoi: string | null = null;

  constructor(private readonly provider: AoiFeatureProvider) {}

  get isLoaded(): boolean {
    return this.loadedAoi !== null;
  }

  /** Fetches trail geometry for an AOI. Safe to call repeatedly; refetches
   * only when the AOI actually changed. */
  async load(aoiSlug: string, signal?: AbortSignal): Promise<void> {
    if (this.loadedAoi === aoiSlug) return;
    const collection = await this.provider.getFeatures(aoiSlug, ["trails"], signal);
    if (signal?.aborted) return;
    this.lines = collection.features
      .filter((f) => f.kind === "trails" && f.geometry.length >= 2)
      .map((f) => f.geometry);
    this.loadedAoi = aoiSlug;
  }

  clear(): void {
    this.lines = [];
    this.loadedAoi = null;
  }

  /** Trails whose bounding box falls within the window around `point`.
   *
   * A cheap bbox reject, not a real spatial index. Fine at AOI scale --
   * hundreds of ways, not millions. If an AOI ever gets big enough for this
   * to show up in a click handler, an R-tree goes here. */
  linesNear(point: LngLat): LngLat[][] {
    if (this.lines.length === 0) return [];
    const minLng = point.lng - NEAR_WINDOW_DEG;
    const maxLng = point.lng + NEAR_WINDOW_DEG;
    const minLat = point.lat - NEAR_WINDOW_DEG;
    const maxLat = point.lat + NEAR_WINDOW_DEG;

    const out: LngLat[][] = [];
    for (const line of this.lines) {
      for (const p of line) {
        if (p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat) {
          out.push(line);
          break;
        }
      }
    }
    return out;
  }
}
