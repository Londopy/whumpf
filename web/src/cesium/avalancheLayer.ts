/** Avalanche danger regions on the Cesium globe.
 *
 * Ported from contour-map's useAvalancheLayer (kiy-codes). Same provider,
 * same 15-minute cache, same two-tier styling for rated vs unrated regions.
 * What changes is the rendering: MapLibre `fill`/`line` layers driven by
 * data expressions become a Cesium GeoJsonDataSource whose entities are
 * styled per-feature in a loop, because Cesium has no equivalent of
 * MapLibre's paint expressions.
 *
 * Note this shows *forecast-center danger ratings* -- polygons covering
 * whole regions. It is not, and must not be presented as, the per-slope
 * terrain filtering that whumpf's attribute shader does. The two answer
 * different questions and are designed to be legible on screen at once.
 */
import type {
  AvalancheProvider,
  AvalancheRegionCollection,
  AvalancheRegionFeature,
} from "../providers/AvalancheProvider";
import { describeNetworkError } from "../net/fetchTimeout";
import { LayerController } from "./layerController";

// Forecast-center danger ratings are issued at most a few times a day --
// re-fetching more often than this would just hit the same data.
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { data: AvalancheRegionCollection; fetchedAt: number } | null = null;

/** Clears the module-level cache. Exposed for the refresh path and tests. */
export function invalidateAvalancheCache(): void {
  cache = null;
}

/** Structural slice of the Cesium API this layer needs, so the module does
 * not take a hard dependency on Cesium's typings. */
export interface CesiumApi {
  GeoJsonDataSource: {
    load(data: unknown, options?: Record<string, unknown>): Promise<CesiumDataSource>;
  };
  Color: {
    fromCssColorString(css: string): CesiumColor;
    WHITE: CesiumColor;
  };
  ScreenSpaceEventHandler: new (element: unknown) => CesiumScreenSpaceHandler;
  ScreenSpaceEventType: { LEFT_CLICK: number; MOUSE_MOVE: number };
  HeightReference?: { CLAMP_TO_GROUND: number };
}

export interface CesiumColor {
  withAlpha(alpha: number): CesiumColor;
}

export interface CesiumEntity {
  properties?: { getValue(time?: unknown): Record<string, unknown> };
  polygon?: {
    material: unknown;
    outline: boolean;
    outlineColor: unknown;
    outlineWidth: number;
    heightReference?: unknown;
classificationType?: unknown;
  };
  polyline?: { material: unknown; width: number };
}

export interface CesiumDataSource {
  entities: { values: CesiumEntity[] };
}

export interface CesiumScreenSpaceHandler {
  setInputAction(action: (event: unknown) => void, type: number): void;
  removeInputAction(type: number): void;
  destroy(): void;
}

export interface CesiumViewerLike {
  scene: { canvas: HTMLCanvasElement };
  dataSources: {
    add(source: CesiumDataSource): Promise<CesiumDataSource>;
    remove(source: CesiumDataSource, destroy?: boolean): boolean;
  };
  pick(position: unknown): { id?: CesiumEntity } | undefined;
}

export class AvalancheLayer extends LayerController {
  private dataSource: CesiumDataSource | null = null;
  private handler: CesiumScreenSpaceHandler | null = null;

  constructor(
    private readonly viewer: CesiumViewerLike,
    private readonly cesium: CesiumApi,
    private readonly provider: AvalancheProvider,
    private readonly onSelect?: (feature: AvalancheRegionFeature) => void,
  ) {
    super();
  }

  protected async attach(signal: AbortSignal): Promise<void> {
    const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;

    let data: AvalancheRegionCollection;
    let fetchedAt: number;

    if (fresh) {
      data = cache!.data;
      fetchedAt = cache!.fetchedAt;
    } else {
      this.setState({ status: "loading", error: null });
      try {
        data = await this.provider.getRegions(signal);
      } catch (err) {
        if (signal.aborted) return;
        this.setState({ status: "error", error: describeNetworkError(err) });
        return;
      }
      if (signal.aborted) return;
      fetchedAt = Date.now();
      cache = { data, fetchedAt };
    }

    const source = await this.cesium.GeoJsonDataSource.load(data, {
      // Styling is applied per-entity below; suppress the defaults so
      // unrated regions don't briefly flash in Cesium's stock colours.
      stroke: this.cesium.Color.WHITE,
      fill: this.cesium.Color.WHITE.withAlpha(0),
      strokeWidth: 1.5,
      clampToGround: true,
    });
    if (signal.aborted) return;

    this.styleEntities(source);
    await this.viewer.dataSources.add(source);
    if (signal.aborted) {
      this.viewer.dataSources.remove(source, true);
      return;
    }

    this.dataSource = source;
    this.wireInteraction();
    this.setState({
      status: "ready",
      error: null,
      count: data.features.length,
      fetchedAt,
    });
  }

  /** MapLibre did this with paint expressions reading feature properties.
   * Cesium has no expression language for entities, so the same rules are
   * applied imperatively -- the thresholds are unchanged. */
  private styleEntities(source: CesiumDataSource): void {
    for (const entity of source.entities.values) {
      const props = entity.properties?.getValue() ?? {};
      const css = typeof props.color === "string" ? props.color : "#888888";
      const danger = typeof props.danger_level === "number" ? props.danger_level : -1;
      const color = this.cesium.Color.fromCssColorString(css);

      // Off-season/no-rating regions (danger_level -1) get a faint outline
      // only -- a real rating gets a visible fill, so the two states are
      // never visually confusable.
      const fillAlpha = danger < 0 ? 0.06 : 0.45;

      if (entity.polygon) {
        entity.polygon.material = color.withAlpha(fillAlpha);
        entity.polygon.outline = true;
        entity.polygon.outlineColor = color.withAlpha(0.8);
        entity.polygon.outlineWidth = 1.5;
      }
      if (entity.polyline) {
        entity.polyline.material = color.withAlpha(0.8);
        entity.polyline.width = 1.5;
      }
    }
  }

  /** Replaces MapLibre's layer-scoped `map.on("click", LAYER_ID, ...)` and
   * the mouseenter/mouseleave cursor pair. Cesium has no per-layer event
   * scoping, so we pick and then check the hit belongs to this data source. */
  private wireInteraction(): void {
    const canvas = this.viewer.scene.canvas;
    const handler = new this.cesium.ScreenSpaceEventHandler(canvas);

    handler.setInputAction((event: unknown) => {
      const position = (event as { position?: unknown }).position;
      if (!position) return;
      const entity = this.pickOwnEntity(position);
      if (!entity) return;
      const props = entity.properties?.getValue() ?? {};
      this.onSelect?.(props as unknown as AvalancheRegionFeature);
    }, this.cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((event: unknown) => {
      const endPosition = (event as { endPosition?: unknown }).endPosition;
      if (!endPosition) return;
      canvas.style.cursor = this.pickOwnEntity(endPosition) ? "pointer" : "";
    }, this.cesium.ScreenSpaceEventType.MOUSE_MOVE);

    this.handler = handler;
  }

  private pickOwnEntity(windowPosition: unknown): CesiumEntity | null {
    const picked = this.viewer.pick(windowPosition);
    const entity = picked?.id;
    if (!entity || !this.dataSource) return null;
    return this.dataSource.entities.values.includes(entity) ? entity : null;
  }

  protected detach(): void {
    if (this.handler) {
      this.handler.removeInputAction(this.cesium.ScreenSpaceEventType.LEFT_CLICK);
      this.handler.removeInputAction(this.cesium.ScreenSpaceEventType.MOUSE_MOVE);
      this.handler.destroy();
      this.handler = null;
    }
    this.viewer.scene.canvas.style.cursor = "";
    if (this.dataSource) {
      this.viewer.dataSources.remove(this.dataSource, true);
      this.dataSource = null;
    }
  }

  /** Forces a network refetch rather than reusing the 15-minute cache. */
  override async refresh(): Promise<void> {
    invalidateAvalancheCache();
    await super.refresh();
  }
}
