import type { AttributionEntry } from "./types";
import { withTimeout } from "../net/fetchTimeout";

const REQUEST_TIMEOUT_MS = 15000;

export interface AvalancheRegionProperties {
  name: string;
  center: string;
  center_id: string;
  center_link: string;
  state: string | null;
  timezone: string;
  off_season: boolean;
  /** Human label as published by the forecast center — "no rating" when
   * off-season or between forecast cycles. Never re-derived from
   * danger_level here; shown verbatim so it always matches what the
   * center itself is saying. */
  danger: string;
  /** -1 = no current rating. Only used to decide styling (dimmed vs
   * coloured), never displayed as a bare number. */
  danger_level: number;
  color: string;
  link: string;
  travel_advice: string | null;
}

export type AvalancheRegionFeature = GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon, AvalancheRegionProperties>;
export type AvalancheRegionCollection = GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, AvalancheRegionProperties>;

export interface AvalancheProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  /** Plain-language coverage limitation, shown in the UI so "no regions
   * visible here" reads as an honest limitation, not a broken layer. */
  readonly coverageDescription: string;
  getRegions(signal?: AbortSignal): Promise<AvalancheRegionCollection>;
}

/**
 * avalanche.org (National Avalanche Center) public map-layer API — free,
 * keyless, confirmed live: GET /v2/public/products/map-layer returns a
 * GeoJSON FeatureCollection of US/Alaska forecast-center regions, one
 * polygon per center, with that center's current overall danger rating.
 * Confirmed via a direct test call (2026-08-24): 83 forecast centers, every
 * one currently "off_season"/"no rating" since it's currently avalanche
 * off-season in the US — that off-season state is real data, not a bug, and
 * the UI must show it honestly rather than treating a quiet season as an
 * error.
 *
 * Coverage: continental US + Alaska only. This is a known, documented
 * limitation — there is no single free/keyless global avalanche API. Other
 * countries' national avalanche warning services could be added later
 * behind this same interface (see AvalancheProvider) once a specific one is
 * verified and its terms confirmed.
 *
 * This endpoint mirrors the one avalanche.org's own public map uses; its
 * written terms of use were not independently reviewed line-by-line here,
 * so treat this as "publicly observed live usage", not a confirmed license
 * grant — worth a proper terms check before any commercial/high-volume use.
 */
export class AvalancheOrgProvider implements AvalancheProvider {
  readonly name = "avalanche.org (National Avalanche Center)";
  readonly coverageDescription = "US and Alaska forecast centers only — no coverage outside the United States.";
  readonly attribution: AttributionEntry = {
    html: 'Avalanche data: <a href="https://avalanche.org" target="_blank" rel="noreferrer">avalanche.org</a> forecast centers',
  };

  async getRegions(signal?: AbortSignal): Promise<AvalancheRegionCollection> {
    const res = await fetch("https://api.avalanche.org/v2/public/products/map-layer", {
      signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const rateLimited = res.status === 429 ? " (rate limited — try again shortly)" : "";
      throw new Error(`avalanche.org request failed: ${res.status}${rateLimited} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as AvalancheRegionCollection;
  }
}
