import {
  Cartesian3,
  Color,
  type Entity,
  type Viewer,
} from "cesium";

/** Lat/lng grid overlay, ported from contour-map's useGraticule (kiy-codes).
 *
 * The original built a GeoJSON FeatureCollection of meridians and parallels
 * and handed it to MapLibre as a geojson source with a line layer and a
 * symbol layer for the labels, regenerating on move.
 *
 * Cesium draws these as polyline entities plus label entities. The spacing
 * ladder is unchanged -- it is chosen so the grid stays readable rather than
 * turning into a solid block of lines as you zoom.
 */
// Degrees between grid lines at a given camera height (metres). Picked so
// roughly 6-12 lines are visible at any zoom -- dense enough to read a
// position off, sparse enough not to obscure terrain.
const SPACING_LADDER: { minHeight: number; step: number }[] = [
  { minHeight: 8_000_000, step: 30 },
  { minHeight: 4_000_000, step: 15 },
  { minHeight: 2_000_000, step: 10 },
  { minHeight: 1_000_000, step: 5 },
  { minHeight: 400_000, step: 2 },
  { minHeight: 200_000, step: 1 },
  { minHeight: 80_000, step: 0.5 },
  { minHeight: 30_000, step: 0.25 },
  { minHeight: 0, step: 0.1 },
];

function stepForHeight(height: number): number {
  for (const rung of SPACING_LADDER) {
    if (height >= rung.minHeight) return rung.step;
  }
  return 0.1;
}

function formatDegrees(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}

export class Graticule {
  private entities: Entity[] = [];
  private stopListening: (() => void) | null = null;
  private enabled = false;
  private lastStep = 0;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: { color?: string; showLabels?: boolean } = {},
  ) {}

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.rebuild();
    this.stopListening = this.viewer.camera.moveEnd.addEventListener(() => this.rebuild());
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.stopListening?.();
    this.stopListening = null;
    this.clear();
    this.lastStep = 0;
  }

  setEnabled(on: boolean): void {
    if (on) this.enable();
    else this.disable();
  }

  /** Redraws only when the spacing rung actually changed -- panning at a
   * fixed altitude leaves the grid alone, which is what the MapLibre
   * version achieved by letting the source data stay put. */
  private rebuild(): void {
    if (!this.enabled) return;
    const step = stepForHeight(this.viewer.camera.positionCartographic.height);
    if (step === this.lastStep) return;
    this.lastStep = step;
    this.clear();

    const css = this.options.color ?? "#ffffff";
    const material = Color.fromCssColorString(css).withAlpha(0.25);
    const showLabels = this.options.showLabels ?? true;

    // Meridians.
    for (let lng = -180; lng <= 180; lng += step) {
      const coords: number[] = [];
      for (let lat = -80; lat <= 80; lat += 2) coords.push(lng, lat);
      this.entities.push(
        this.viewer.entities.add({
          polyline: { positions: Cartesian3.fromDegreesArray(coords), width: 1, material, clampToGround: true },
        }),
      );
      if (showLabels) this.addLabel(lng, 0, `${formatDegrees(lng, step)}°`);
    }

    // Parallels. Stop short of the poles: meridian convergence makes lines
    // above ~80° visually useless and expensive to draw.
    for (let lat = -80; lat <= 80; lat += step) {
      const coords: number[] = [];
      for (let lng = -180; lng <= 180; lng += 2) coords.push(lng, lat);
      this.entities.push(
        this.viewer.entities.add({
          polyline: { positions: Cartesian3.fromDegreesArray(coords), width: 1, material, clampToGround: true },
        }),
      );
      if (showLabels) this.addLabel(0, lat, `${formatDegrees(lat, step)}°`);
    }
  }

  private addLabel(lng: number, lat: number, text: string): void {
    this.entities.push(
      this.viewer.entities.add({
        position: Cartesian3.fromDegrees(lng, lat),
        label: {
          text,
          font: "12px sans-serif",
          fillColor: Color.fromCssColorString("#ffffff").withAlpha(0.7),
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#000000").withAlpha(0.4),
        },
      }),
    );
  }

  private clear(): void {
    for (const entity of this.entities) this.viewer.entities.remove(entity);
    this.entities = [];
  }
}
