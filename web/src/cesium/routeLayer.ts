/** Route editing and rendering on the Cesium globe.
 *
 * Ported from contour-map's useRouteLayer (kiy-codes). The routing calls,
 * debounce, waytype colouring, and marker semantics are unchanged. Three
 * things had to be rebuilt because Cesium has no equivalent:
 *
 *   1. Draggable markers. MapLibre ships `maplibregl.Marker({draggable})`;
 *      Cesium has no marker primitive at all, so drag is implemented here
 *      against ScreenSpaceEventHandler (down / move / up) with camera
 *      control suspended for the duration.
 *   2. Data-driven line colour. MapLibre's `["match", ["get","category"]...]`
 *      paint expression becomes one polyline entity per waytype segment,
 *      each with a literal colour.
 *   3. Trail snapping -- see TrailGeometrySource below. This is the one
 *      place the port genuinely loses a capability rather than relocating
 *      it, and the reason is worth reading.
 */
import type { RouteAction, RouteEditorState } from "../routing/routeReducer";
import type { RoutingProvider, RouteResult } from "../providers/RoutingProvider";
import type { LngLat } from "../providers/types";
import { nearestPointOnLines } from "../geo/nearestPointOnLine";
import { describeNetworkError } from "../net/fetchTimeout";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  type Entity,
  HeightReference,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from "cesium";

// Clicks/drags within this distance of a trail snap onto it; farther than
// this, the point is assumed to genuinely be off-trail (e.g. a trailhead
// car park) and is left where the user put it.
const MAX_SNAP_DISTANCE_METERS = 35;

// Matches the MapLibre implementation's debounce before hitting the router.
const ROUTE_DEBOUNCE_MS = 400;

const CATEGORY_COLORS: Record<string, string> = {
  trail: "#22c55e",
  road: "#f59e0b",
};
const DEFAULT_ROUTE_COLOR = "#2563eb";
const CASING_COLOR = "#ffffff";

/**
 * Supplies candidate trail geometry for waypoint snapping.
 *
 * In contour-map this was free: the base map was an OSM vector tileset, so
 * `map.querySourceFeatures` read trail linework straight out of tiles the
 * renderer had already downloaded -- no network call, no extra budget.
 *
 * Cesium draws imagery as rasters and holds no vector features, so that
 * query has no counterpart. Rather than silently drop snapping, it is
 * expressed as an interface: supply a source and snapping works exactly as
 * before; supply nothing and waypoints land where the user clicked, which
 * is precisely the fallback the original took whenever no trail was loaded
 * nearby. Behaviour degrades along a path his code already handled.
 *
 * Wiring a real one is a follow-up -- an Overpass query around the click,
 * or a trails endpoint on whumpf's Flask API, are both reasonable.
 */
export interface TrailGeometrySource {
  /** Trail polylines near a point, in whatever local window makes sense. */
  linesNear(point: LngLat): LngLat[][];
}

/**
 * Controls the route line and waypoint markers.
 *
 * The React version was three `useEffect`s keyed on different slices of
 * state. Here that becomes explicit calls: `setState` when the editor
 * state changes, `showImported` for a loaded GPX track. The debounce and
 * cancellation semantics are preserved.
 */
export class RouteLayer {
  private markers: Entity[] = [];
  private routeEntities: Entity[] = [];
  private handler: ScreenSpaceEventHandler | null = null;

  private state: RouteEditorState | null = null;
  private importedResult: RouteResult | null = null;

  private routeTimer: ReturnType<typeof setTimeout> | null = null;
  private routeGeneration = 0;

  private dragIndex: number | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly routingProvider: RoutingProvider,
    private readonly dispatch: (action: RouteAction) => void,
    private readonly onRouteComputed: (result: RouteResult | null, error: string | null) => void,
    private readonly trails: TrailGeometrySource | null = null,
  ) {
    this.wireInteraction();
  }

  /** Feeds new editor state in. Replaces the effects keyed on
   * `state.waypoints` and `state.mode`. */
  setState(state: RouteEditorState): void {
    const waypointsChanged =
      !this.state || !sameWaypoints(this.state.waypoints, state.waypoints);
    const modeChanged = !this.state || this.state.mode !== state.mode;
    this.state = state;

    if (waypointsChanged) this.syncMarkers(state.waypoints);
    if ((waypointsChanged || modeChanged) && !this.importedResult) {
      this.scheduleRoute();
    }
  }

  /** Displays a finished geometry (an imported GPX track) instead of
   * computing one. While set, waypoint edits do not trigger routing. */
  showImported(result: RouteResult | null): void {
    this.importedResult = result;
    if (result) {
      this.drawRoute(result);
      this.onRouteComputed(result, null);
    } else {
      this.clearRoute();
      this.onRouteComputed(null, null);
    }
  }

  destroy(): void {
    if (this.routeTimer) clearTimeout(this.routeTimer);
    this.routeTimer = null;
    this.routeGeneration++;
    if (this.handler) {
      for (const type of [
        ScreenSpaceEventType.LEFT_CLICK,
        ScreenSpaceEventType.LEFT_DOWN,
        ScreenSpaceEventType.LEFT_UP,
        ScreenSpaceEventType.MOUSE_MOVE,
      ]) {
        this.handler.removeInputAction(type);
      }
      this.handler.destroy();
      this.handler = null;
    }
    this.clearMarkers();
    this.clearRoute();
  }

  // --- snapping ----------------------------------------------------------

  /** Snaps a point onto the nearest trail if one is close enough, else
   * returns it unchanged. Identical thresholds to the MapLibre version;
   * only the geometry source differs (see TrailGeometrySource). */
  private snap(point: LngLat): LngLat {
    if (!this.trails) return point;
    let lines: LngLat[][];
    try {
      lines = this.trails.linesNear(point);
    } catch {
      return point;
    }
    if (lines.length === 0) return point;
    const nearest = nearestPointOnLines(point, lines);
    if (!nearest || nearest.distanceMeters > MAX_SNAP_DISTANCE_METERS) return point;
    return nearest.point;
  }

  // --- interaction -------------------------------------------------------

  private wireInteraction(): void {
    const handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    const T = ScreenSpaceEventType;

    // Click on the globe adds a waypoint, but only while editing and only
    // when the click did not land on an existing marker (which means
    // "delete", matching the marker click handler in the original).
    handler.setInputAction((event: any) => {
      if (!this.state?.isEditing) return;
      const hitIndex = this.markerIndexAt(event.position);
      if (hitIndex !== null) {
        this.dispatch({ type: "DELETE_WAYPOINT", index: hitIndex });
        return;
      }
      const point = this.pickGlobe(event.position);
      if (!point) return;
      this.dispatch({ type: "ADD_WAYPOINT", point: this.snap(point) });
    }, T.LEFT_CLICK);

    // Drag: MapLibre gave us draggable markers for free. Cesium does not,
    // so we suspend camera rotation while a marker is held and restore it
    // on release -- without that the globe spins under the cursor.
    handler.setInputAction((event: any) => {
      if (!this.state?.isEditing) return;
      const index = this.markerIndexAt(event.position);
      if (index === null) return;
      this.dragIndex = index;
      this.viewer.scene.screenSpaceCameraController.enableRotate = false;
      this.viewer.scene.screenSpaceCameraController.enableTranslate = false;
    }, T.LEFT_DOWN);

    handler.setInputAction((event: any) => {
      if (this.dragIndex === null) return;
      const point = this.pickGlobe(event.endPosition);
      if (!point) return;
      const marker = this.markers[this.dragIndex];
      if (marker) {
        marker.position = new ConstantPositionProperty(Cartesian3.fromDegrees(point.lng, point.lat));
      }
    }, T.MOUSE_MOVE);

    handler.setInputAction((event: any) => {
      if (this.dragIndex === null) return;
      const index = this.dragIndex;
      this.dragIndex = null;
      this.viewer.scene.screenSpaceCameraController.enableRotate = true;
      this.viewer.scene.screenSpaceCameraController.enableTranslate = true;

      const point = this.pickGlobe(event.position);
      if (!point) return;
      const snapped = this.snap(point);
      const marker = this.markers[index];
      if (marker) {
        marker.position = new ConstantPositionProperty(Cartesian3.fromDegrees(snapped.lng, snapped.lat));
      }
      this.dispatch({ type: "MOVE_WAYPOINT", index, point: snapped });
    }, T.LEFT_UP);

    this.handler = handler;
  }

  /** Converts a screen position to lon/lat on the globe surface, or null if
   * the ray missed (pointing at sky). */
  private pickGlobe(windowPosition: Cartesian2): LngLat | null {
    const ray = this.viewer.camera.getPickRay(windowPosition);
    if (!ray) return null;
    const cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
    if (!cartesian) return null;
    const carto = Cartographic.fromCartesian(cartesian);
    if (!carto) return null;
    return {
      lng: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
    };
  }

  private markerIndexAt(windowPosition: Cartesian2): number | null {
    const picked = this.viewer.scene.pick(windowPosition);
    if (!picked?.id) return null;
    const index = this.markers.indexOf(picked.id);
    return index === -1 ? null : index;
  }

  // --- markers -----------------------------------------------------------

  private syncMarkers(waypoints: LngLat[]): void {
    this.clearMarkers();
    this.markers = waypoints.map((point, index) => {
      const isEndpoint = index === 0 || index === waypoints.length - 1;
      const color =
        index === 0 ? "#22c55e" : index === waypoints.length - 1 ? "#ef4444" : "#2563eb";
      return this.viewer.entities.add({
        position: Cartesian3.fromDegrees(point.lng, point.lat),
        point: {
          pixelSize: isEndpoint ? 16 : 11,
          color: Color.fromCssColorString(color),
          outlineColor: Color.fromCssColorString("#ffffff"),
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
    });
  }

  private clearMarkers(): void {
    for (const marker of this.markers) this.viewer.entities.remove(marker);
    this.markers = [];
  }

  // --- route line --------------------------------------------------------

  private scheduleRoute(): void {
    if (this.routeTimer) clearTimeout(this.routeTimer);
    const state = this.state;
    if (!state) return;

    if (state.waypoints.length < 2) {
      this.clearRoute();
      this.onRouteComputed(null, null);
      return;
    }

    const generation = ++this.routeGeneration;
    this.routeTimer = setTimeout(async () => {
      try {
        const result = await this.routingProvider.route(state.waypoints, state.mode);
        if (generation !== this.routeGeneration) return;
        this.drawRoute(result);
        this.onRouteComputed(result, null);
      } catch (err) {
        if (generation !== this.routeGeneration) return;
        this.onRouteComputed(null, describeNetworkError(err));
      }
    }, ROUTE_DEBOUNCE_MS);
  }

  /** One polyline per waytype segment so each can carry its own colour --
   * the stand-in for MapLibre's data-driven `match` expression. Routes with
   * no breakdown (manual mode) draw as a single default-blue line. */
  private drawRoute(result: RouteResult): void {
    this.clearRoute();
    const coords = result.points.map((p) => [p.lng, p.lat] as [number, number]);
    if (coords.length < 2) return;

    const segments: { coords: [number, number][]; color: string }[] =
      result.waytypeBreakdown && result.waytypeBreakdown.length > 0
        ? result.waytypeBreakdown.map((seg) => ({
            coords: coords.slice(seg.startIndex, seg.endIndex + 1),
            color: CATEGORY_COLORS[seg.category] ?? DEFAULT_ROUTE_COLOR,
          }))
        : [{ coords, color: DEFAULT_ROUTE_COLOR }];

    for (const segment of segments) {
      if (segment.coords.length < 2) continue;
      const positions = Cartesian3.fromDegreesArray(segment.coords.flat());

      // Casing first so the coloured line sits on top, matching the
      // two-layer white-under-colour treatment in the original.
      this.routeEntities.push(
        this.viewer.entities.add({
          polyline: {
            positions,
            width: 6,
            material: Color.fromCssColorString(CASING_COLOR),
            clampToGround: true,
          },
        }),
      );
      this.routeEntities.push(
        this.viewer.entities.add({
          polyline: {
            positions,
            width: 4,
            material: Color.fromCssColorString(segment.color),
            clampToGround: true,
          },
        }),
      );
    }
  }

  private clearRoute(): void {
    for (const entity of this.routeEntities) this.viewer.entities.remove(entity);
    this.routeEntities = [];
  }
}

function sameWaypoints(a: LngLat[], b: LngLat[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.lng === b[i].lng && p.lat === b[i].lat);
}
