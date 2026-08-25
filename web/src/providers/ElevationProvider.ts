/** Elevation queries, ported from contour-map (kiy-codes).
 *
 * The interface is unchanged. Only the implementation swaps: MapLibre's
 * `map.queryTerrainElevation` becomes Cesium's globe sampling.
 */
import type { LngLat, LngLatElevation } from "./types";

/**
 * Answers point/path elevation queries. The intended implementation samples
 * whichever TerrainProvider DEM tiles are already loaded for 3D terrain
 * rendering, rather than making a separate network call per query -- keeps
 * elevation profile generation fast and avoids depending on a second
 * rate-limited service.
 */
export interface ElevationProvider {
  getElevation(point: LngLat): Promise<number | null>;
  getElevationProfile(points: LngLat[]): Promise<LngLatElevation[]>;
}

/** Minimal structural types for the bits of Cesium this file touches, so the
 * module stays compilable without a hard dependency on Cesium's typings. */
interface CesiumLike {
  Cartographic: {
    fromDegrees(lon: number, lat: number, height?: number): unknown;
  };
  sampleTerrainMostDetailed?(provider: unknown, positions: unknown[]): Promise<unknown[]>;
}

interface ViewerLike {
  scene: {
    globe: {
      getHeight(cartographic: unknown): number | undefined;
      terrainProvider: unknown;
    };
  };
}

/**
 * Samples elevation from the Cesium globe.
 *
 * `globe.getHeight` is the direct analogue of MapLibre's
 * `queryTerrainElevation`: it reads the terrain tiles already resident for
 * rendering and returns undefined when the relevant tile has not loaded yet.
 * Callers must treat that as "unknown" and never fabricate a value.
 *
 * Profiles optionally upgrade to `sampleTerrainMostDetailed`, which requests
 * the highest-available tiles for the sample points. That does hit the
 * network, but against the *same* terrain provider already configured for
 * the scene -- it does not introduce the second rate-limited service the
 * original was written to avoid. It is off by default so behaviour matches
 * the MapLibre build unless you opt in.
 */
export class CesiumElevationProvider implements ElevationProvider {
  constructor(
    private readonly getViewer: () => ViewerLike | null,
    private readonly cesium: CesiumLike,
    private readonly options: { detailedProfiles?: boolean } = {},
  ) {}

  async getElevation(point: LngLat): Promise<number | null> {
    const viewer = this.getViewer();
    if (!viewer) return null;
    const carto = this.cesium.Cartographic.fromDegrees(point.lng, point.lat);
    const height = viewer.scene.globe.getHeight(carto);
    return height ?? null;
  }

  async getElevationProfile(points: LngLat[]): Promise<LngLatElevation[]> {
    const viewer = this.getViewer();
    if (!viewer) return points.map((p) => ({ ...p, elevation: undefined }));

    if (this.options.detailedProfiles && this.cesium.sampleTerrainMostDetailed) {
      const cartos = points.map((p) => this.cesium.Cartographic.fromDegrees(p.lng, p.lat));
      try {
        const sampled = (await this.cesium.sampleTerrainMostDetailed(
          viewer.scene.globe.terrainProvider,
          cartos,
        )) as { height?: number }[];
        return points.map((p, i) => ({ ...p, elevation: sampled[i]?.height ?? undefined }));
      } catch {
        // Fall through to the resident-tile path rather than failing the
        // whole profile -- a coarse profile beats no profile.
      }
    }

    const results: LngLatElevation[] = [];
    for (const point of points) {
      const elevation = await this.getElevation(point);
      results.push({ ...point, elevation: elevation ?? undefined });
    }
    return results;
  }
}
