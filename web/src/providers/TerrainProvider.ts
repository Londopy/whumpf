import type { AttributionEntry } from "./types";

/**
 * Supplies elevation DEM tiles used for 3D terrain, hillshading, contour
 * generation, and (indirectly, via ElevationProvider) elevation queries.
 */
export interface TerrainProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  /** MapLibre raster-dem tile URL template, e.g. ".../{z}/{x}/{y}.png". */
  getTileUrlTemplate(): string;
  readonly encoding: "terrarium" | "mapbox";
  readonly maxZoom: number;
  readonly tileSize: number;
}

/**
 * AWS Open Data Terrarium tiles (elevation-tiles-prod S3 bucket) — free,
 * no API key, commercial use + redistribution permitted per the
 * Tilezen/Joerd attribution doc. See architecture.md for the full
 * per-region attribution list this consolidated string stands in for.
 */
export class AwsTerrariumTerrainProvider implements TerrainProvider {
  readonly name = "AWS Terrain Tiles (Terrarium)";
  readonly encoding = "terrarium" as const;
  readonly maxZoom = 15;
  readonly tileSize = 256;
  readonly attribution: AttributionEntry = {
    html: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Mapzen, SRTM, and others</a>',
  };

  getTileUrlTemplate(): string {
    return "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  }
}

/** Decodes a Terrarium-encoded RGB pixel triple into meters of elevation. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}
