/** Ski runs and lifts on the Cesium globe.
 *
 * Replaces contour-map's useSkiLayers (kiy-codes), which was the one piece
 * the port could not carry across: it read an OpenSkiMap vector tileset,
 * and Cesium has no vector-tile pipeline.
 *
 * The data now comes from whumpf's own /api/aoi/<slug>/features, which
 * fetches one AOI's bounding box from OSM and returns GeoJSON. That is a
 * better fit than the original: real features the user can click and
 * filter, scoped to the AOI the app is already built around, instead of a
 * world-wide tileset. The server emits OpenSkiMap's property names, so his
 * parseSkiRunProperties/parseSkiLiftProperties run on it unchanged.
 */
import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  type Entity,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from "cesium";
import {
  parseSkiLiftProperties,
  parseSkiRunProperties,
  type PisteDifficulty,
  type SkiLift,
  type SkiRun,
} from "../providers/SkiDataProvider";
import type { AoiFeature, AoiFeatureProvider } from "../providers/AoiFeatureProvider";
import { pathLength } from "../geo/distance";
import { describeNetworkError } from "../net/fetchTimeout";
import { LayerController } from "./layerController";

const RUN_WIDTH = 3;
const LIFT_WIDTH = 2;
const FALLBACK_RUN_COLOR = "#2b6cb0";

export type SkiSelection =
  | { kind: "run"; run: SkiRun }
  | { kind: "lift"; lift: SkiLift };

export interface SkiLayerOptions {
  /** Show only these difficulties. Empty/undefined shows all. */
  difficulties?: PisteDifficulty[];
  showRuns?: boolean;
  showLifts?: boolean;
}

export class SkiLayer extends LayerController {
  private entities: Entity[] = [];
  private handler: ScreenSpaceEventHandler | null = null;
  private byEntity = new Map<Entity, SkiSelection>();
  private options: SkiLayerOptions = { showRuns: true, showLifts: true };

  constructor(
    private readonly viewer: Viewer,
    private readonly provider: AoiFeatureProvider,
    private readonly aoiSlug: string,
    private readonly onSelect?: (selection: SkiSelection) => void,
  ) {
    super();
  }

  /** Adjusts filtering. Cheap: re-styles what is already loaded rather than
   * refetching, since the AOI's features do not change between calls. */
  setOptions(options: SkiLayerOptions): void {
    this.options = { ...this.options, ...options };
    for (const [entity, selection] of this.byEntity) {
      entity.show = this.isVisible(selection);
    }
  }

  private isVisible(selection: SkiSelection): boolean {
    if (selection.kind === "lift") return this.options.showLifts !== false;
    if (this.options.showRuns === false) return false;
    const filter = this.options.difficulties;
    if (!filter || filter.length === 0) return true;
    return filter.includes(selection.run.difficulty);
  }

  protected async attach(signal: AbortSignal): Promise<void> {
    this.setState({ status: "loading", error: null });

    let collection;
    try {
      collection = await this.provider.getFeatures(this.aoiSlug, ["runs", "lifts"], signal);
    } catch (err) {
      if (signal.aborted) return;
      this.setState({ status: "error", error: describeNetworkError(err) });
      return;
    }
    if (signal.aborted) return;

    for (const feature of collection.features) {
      if (feature.kind === "runs") this.addRun(feature);
      else if (feature.kind === "lifts") this.addLift(feature);
    }

    this.wireInteraction();
    this.setState({
      status: "ready",
      error: null,
      count: this.entities.length,
      fetchedAt: Date.now(),
    });
  }

  private addRun(feature: AoiFeature): void {
    const parsed = parseSkiRunProperties(feature.id, feature.properties);
    const run: SkiRun = {
      ...parsed,
      geometry: feature.geometry,
      // Computed from the real geometry, never read from a data field --
      // same rule the desktop client followed.
      lengthMeters: pathLength(feature.geometry),
    };
    const entity = this.addLine(feature, run.color ?? FALLBACK_RUN_COLOR, RUN_WIDTH);
    if (entity) this.register(entity, { kind: "run", run });
  }

  private addLift(feature: AoiFeature): void {
    const parsed = parseSkiLiftProperties(feature.id, feature.properties);
    const lift: SkiLift = { ...parsed, geometry: feature.geometry };
    const entity = this.addLine(feature, lift.color ?? "#a1a1aa", LIFT_WIDTH);
    if (entity) this.register(entity, { kind: "lift", lift });
  }

  private addLine(feature: AoiFeature, css: string, width: number): Entity | null {
    if (feature.geometry.length < 2) return null;
    const flat = feature.geometry.flatMap((p) => [p.lng, p.lat]);
    const entity = this.viewer.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArray(flat),
        width,
        material: new ColorMaterialProperty(Color.fromCssColorString(css)),
        // Runs and lifts are terrain features; draping them keeps them on
        // the slope instead of floating through it as the camera tilts.
        clampToGround: new ConstantProperty(true),
      },
    });
    this.entities.push(entity);
    return entity;
  }

  private register(entity: Entity, selection: SkiSelection): void {
    this.byEntity.set(entity, selection);
    entity.show = this.isVisible(selection);
  }

  private wireInteraction(): void {
    if (!this.onSelect) return;
    const handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = this.viewer.scene.pick(event.position);
      const selection = picked?.id ? this.byEntity.get(picked.id) : undefined;
      if (selection) this.onSelect?.(selection);
    }, ScreenSpaceEventType.LEFT_CLICK);
    this.handler = handler;
  }

  protected detach(): void {
    if (this.handler) {
      this.handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
      this.handler.destroy();
      this.handler = null;
    }
    for (const entity of this.entities) this.viewer.entities.remove(entity);
    this.entities = [];
    this.byEntity.clear();
  }
}
