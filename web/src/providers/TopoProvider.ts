import type { AttributionEntry } from "./types";

/** Supplies the raster hillshaded/hypsometric imagery for the flat 2D
 * "Terrain" map mode — distinct from TerrainProvider, which supplies DEM
 * tiles for 3D terrain extrusion. */
export interface TopoProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  readonly tileUrlTemplates: string[];
  readonly maxZoom: number;
}

/** OpenTopoMap — free, keyless, no signup. Confirmed live via a direct
 * tile fetch (200 image/png). Usage policy asks for a real User-Agent (set
 * by the Tauri HTTP layer elsewhere in this app) and self-hosting for high
 * volume — this app's traffic is nowhere near their ~400k tiles/month
 * soft threshold, and tiles are cached locally besides. */
export class OpenTopoMapProvider implements TopoProvider {
  readonly name = "OpenTopoMap";
  readonly maxZoom = 17;
  readonly attribution: AttributionEntry = {
    html: 'Terrain style: <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC-BY-SA</a>)',
  };
  readonly tileUrlTemplates = [
    "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
    "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
  ];
}
