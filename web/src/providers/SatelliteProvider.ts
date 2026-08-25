import type { AttributionEntry } from "./types";

/**
 * Supplies raster satellite/aerial imagery for "Satellite" map mode —
 * combine with the independent 3D Terrain toggle for a satellite-draped
 * 3D view (no separate "3D Satellite" mode needed; it was identical to
 * that combination and was removed).
 */
export interface SatelliteProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  readonly requiresApiKey: boolean;
  getTileUrlTemplate(apiKey?: string): string;
  readonly maxZoom: number;
}

/**
 * Esri World Imagery via the ArcGIS Location Platform's API-key-gated tile
 * endpoint (`ibasemaps-api.arcgis.com`) — NOT the legacy keyless
 * `services.arcgisonline.com` endpoint, whose terms are scoped to
 * OSM-editor tracing use only (see architecture.md). Confirmed live: a
 * direct tile fetch with a real key returns 200 image/jpeg.
 */
export class EsriWorldImageryProvider implements SatelliteProvider {
  readonly name = "Esri World Imagery";
  readonly requiresApiKey = true;
  readonly maxZoom = 19; // Esri's published max LOD for the base tile cache
  readonly attribution: AttributionEntry = {
    html: 'Imagery: <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>',
  };

  getTileUrlTemplate(apiKey?: string): string {
    return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${apiKey ?? ""}`;
  }
}
