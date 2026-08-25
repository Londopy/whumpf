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
import {
  type Cartesian2,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  type Entity,
  GeoJsonDataSource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from "cesium";

// Forecast-center danger ratings are issued at most a few times a day --
// re-fetching more often than this would just hit the same data.
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { data: AvalancheRegionCollection; fetchedAt: number } | null = null;

/** Clears the module-level cache. Exposed for the refresh path and tests. */
export function invalidateAvalancheCache(): void {
  cache = null;
}

export class AvalancheLayer extends LayerController {
  private dataSource: GeoJsonDataSource | null = null;
  private handler: ScreenSpaceEventHandler | null = null;

  constructor(
    private readonly viewer: Viewer,
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

    const source = await GeoJsonDataSource.load(data, {
      // Styling is applied per-entity below; suppress the defaults so
      // unrated regions don't briefly flash in Cesium's stock colours.
      stroke: Color.WHITE,
      fill: Color.WHITE.withAlpha(0),
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
  private styleEntities(source: GeoJsonDataSource): void {
    for (const entity of source.entities.values) {
      const props = entity.properties?.getValue() ?? {};
      const css = typeof props.color === "string" ? props.color : "#888888";
      const danger = typeof props.danger_level === "number" ? props.danger_level : -1;
      const color = Color.fromCssColorString(css);

      // Off-season/no-rating regions (danger_level -1) get a faint outline
      // only -- a real rating gets a visible fill, so the two states are
      // never visually confusable.
      const fillAlpha = danger < 0 ? 0.06 : 0.45;

      if (entity.polygon) {
        entity.polygon.material = new ColorMaterialProperty(color.withAlpha(fillAlpha));
        entity.polygon.outline = new ConstantProperty(true);
        entity.polygon.outlineColor = new ConstantProperty(color.withAlpha(0.8));
        entity.polygon.outlineWidth = new ConstantProperty(1.5);
      }
      if (entity.polyline) {
        entity.polyline.material = new ColorMaterialProperty(color.withAlpha(0.8));
        entity.polyline.width = new ConstantProperty(1.5);
      }
    }
  }

  /** Replaces MapLibre's layer-scoped `map.on("click", LAYER_ID, ...)` and
   * the mouseenter/mouseleave cursor pair. Cesium has no per-layer event
   * scoping, so we pick and then check the hit belongs to this data source. */
  private wireInteraction(): void {
    const canvas = this.viewer.scene.canvas;
    const handler = new ScreenSpaceEventHandler(canvas);

    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      const position = event.position;
      if (!position) return;
      const entity = this.pickOwnEntity(position);
      if (!entity) return;
      const props = entity.properties?.getValue() ?? {};
      this.onSelect?.(props as unknown as AvalancheRegionFeature);
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
      const endPosition = event.endPosition;
      if (!endPosition) return;
      canvas.style.cursor = this.pickOwnEntity(endPosition) ? "pointer" : "";
    }, ScreenSpaceEventType.MOUSE_MOVE);

    this.handler = handler;
  }

  private pickOwnEntity(windowPosition: Cartesian2): Entity | null {
    const picked = this.viewer.scene.pick(windowPosition);
    const entity = picked?.id;
    if (!entity || !this.dataSource) return null;
    return this.dataSource.entities.values.includes(entity) ? entity : null;
  }

  protected detach(): void {
    if (this.handler) {
      this.handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
      this.handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
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
