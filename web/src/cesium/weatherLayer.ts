/** Weather raster overlay on the Cesium globe.
 *
 * Ported from contour-map's useWeatherMapLayer (kiy-codes). The refresh
 * bucketing, single-select behaviour, and deliberate cache bypass are all
 * carried over verbatim in intent; only the layer mechanism changes from a
 * MapLibre raster source to a Cesium ImageryLayer.
 *
 * Shows one layer at a time -- stacking several semi-transparent weather
 * rasters is visually unreadable.
 *
 * Deliberately bypasses the persistent tile cache: these tiles represent
 * current conditions, not static geography, so indefinite LRU-cached storage
 * risks silently serving old weather as current. A cache-busting timestamp
 * bucket is appended every `refreshIntervalMs` to force genuinely fresh
 * tiles rather than trusting the browser HTTP cache to revalidate.
 */
import type { WeatherMapLayerId, WeatherMapProvider } from "../providers/WeatherProvider";
import { createCachedImageryLayer, type CesiumImageryLayer, type ImageryCesiumApi, type ImageryViewerLike } from "./cachedImagery";
import { Observable } from "./layerController";

export type WeatherTileStatus = "idle" | "loading" | "ready" | "error";

export interface WeatherLayerState {
  status: WeatherTileStatus;
  lastRefreshedAt: number | null;
}

export class WeatherLayer {
  readonly state = new Observable<WeatherLayerState>({ status: "idle", lastRefreshedAt: null });

  private layer: CesiumImageryLayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeLayer: WeatherMapLayerId | "none" = "none";

  constructor(
    private readonly viewer: ImageryViewerLike,
    private readonly cesium: ImageryCesiumApi,
    private readonly provider: WeatherMapProvider,
    private readonly apiKey: string | undefined,
  ) {}

  /** Selects which weather layer to show, or "none" to clear. */
  setLayer(id: WeatherMapLayerId | "none"): void {
    this.activeLayer = id;
    this.rebuild();
  }

  destroy(): void {
    this.stopRefresh();
    this.removeLayer();
    this.state.set({ status: "idle", lastRefreshedAt: null });
  }

  private rebuild(): void {
    this.removeLayer();
    this.stopRefresh();

    if (this.activeLayer === "none" || !this.apiKey) {
      this.state.set({ status: "idle", lastRefreshedAt: null });
      return;
    }

    this.draw();
    const interval = this.provider.refreshIntervalMs;
    if (interval && interval > 0) {
      this.timer = setInterval(() => this.draw(), interval);
    }
  }

  private draw(): void {
    if (this.activeLayer === "none" || !this.apiKey) return;
    this.state.set({ status: "loading", lastRefreshedAt: this.state.value.lastRefreshedAt });

    // Bucketed cache-buster: stable within a refresh window so tiles in the
    // same frame share a URL, and changes on each refresh so the browser
    // cannot serve a stale frame.
    const interval = this.provider.refreshIntervalMs || 600_000;
    const bucket = Math.floor(Date.now() / interval);
    const base = this.provider.getTileUrlTemplate(this.activeLayer, this.apiKey);
    const urlTemplate = `${base}${base.includes("?") ? "&" : "?"}_b=${bucket}`;

    const previous = this.layer;
    try {
      this.layer = createCachedImageryLayer(this.cesium, {
        urlTemplate,
        attributionHtml: this.provider.attribution?.html,
        alpha: 0.75,
        // Current conditions must not persist in the LRU cache.
        cache: false,
      });
      this.viewer.imageryLayers.add(this.layer);
      // Remove the previous frame only once its replacement is in, so the
      // overlay does not blink on every refresh.
      if (previous) this.viewer.imageryLayers.remove(previous, true);
      this.state.set({ status: "ready", lastRefreshedAt: Date.now() });
    } catch {
      this.state.set({ status: "error", lastRefreshedAt: this.state.value.lastRefreshedAt });
    }
  }

  private removeLayer(): void {
    if (this.layer) {
      this.viewer.imageryLayers.remove(this.layer, true);
      this.layer = null;
    }
  }

  private stopRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
