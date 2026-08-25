// Shared domain types used across all provider interfaces.
// The app talks to these types, never to a specific vendor's raw response shape.

export interface LngLat {
  lng: number;
  lat: number;
}

export interface LngLatElevation extends LngLat {
  /** Elevation in meters, if known. */
  elevation?: number;
}

export type MapStyleMode = "standard" | "satellite" | "terrain";

export interface AttributionEntry {
  /** Plain text or HTML attribution string, as required by the provider's terms. */
  html: string;
}
