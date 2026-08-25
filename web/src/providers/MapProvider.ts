import type { AttributionEntry } from "./types";

/**
 * Supplies the base vector/raster style for the "Standard" map mode.
 * Swappable: replace the OpenFreeMap implementation with any MapLibre-style
 * provider (self-hosted tiles, a commercial vector basemap, etc.) without
 * touching MapCanvas or any other app code.
 */
export interface MapProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  /** Returns a MapLibre style URL or inline style spec. */
  getStyle(): string | Promise<string>;
}

/**
 * OpenFreeMap public instance — free, unlimited, no API key.
 * https://openfreemap.org (self-hostable if the public instance ever
 * becomes unavailable; see plan verification notes).
 */
export class OpenFreeMapProvider implements MapProvider {
  readonly name = "OpenFreeMap";
  readonly attribution: AttributionEntry = {
    html: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  };

  constructor(private readonly styleName: "liberty" | "bright" | "positron" = "liberty") {}

  getStyle(): string {
    return `https://tiles.openfreemap.org/styles/${this.styleName}`;
  }
}
