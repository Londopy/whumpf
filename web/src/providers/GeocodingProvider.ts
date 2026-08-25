import type { LngLat } from "./types";
import { cacheGetJson, cachePutJson } from "../cache/persistentCache";

export type PlaceType =
  | "country"
  | "region"
  | "city"
  | "town"
  | "village"
  | "street"
  | "address"
  | "peak"
  | "lake"
  | "poi"
  | "other";

export interface SearchResult {
  id: string;
  name: string;
  label: string;
  type: PlaceType;
  center: LngLat;
  /** Bounding box for fly-to framing, if the provider supplies one. */
  bbox?: [number, number, number, number];
  country?: string;
  region?: string;
}

/**
 * Powers the search bar. Intended primary/fallback pair: Photon (fast,
 * typeahead-friendly) with Nominatim as a fallback, both free/keyless but
 * rate-limited — results are debounced and cached client-side by the
 * consumer, not inside this interface.
 */
export interface GeocodingProvider {
  readonly name: string;
  search(query: string, opts?: { limit?: number; near?: LngLat; signal?: AbortSignal }): Promise<SearchResult[]>;
}

// Identifies this app to shared community infrastructure, as required by
// Nominatim's usage policy — a stock/library User-Agent is explicitly
// disallowed there. Plain browser fetch() cannot set this header at all,
// which is why these providers go through Tauri's HTTP plugin instead.
const USER_AGENT = "Contour-DesktopApp/0.1 (personal project, non-commercial)";

function photonTypeFromProperties(props: Record<string, unknown>): PlaceType {
  const key = String(props.osm_key ?? "");
  const value = String(props.osm_value ?? "");
  if (key === "place") {
    if (value === "country") return "country";
    if (value === "state" || value === "region") return "region";
    if (value === "city") return "city";
    if (value === "town") return "town";
    if (value === "village" || value === "hamlet") return "village";
  }
  if (key === "highway") return "street";
  if (key === "building" || value === "house") return "address";
  if (key === "natural" && value === "peak") return "peak";
  if (key === "natural" && (value === "water" || value === "bay")) return "lake";
  if (key === "waterway") return "lake";
  if (key === "tourism" || key === "leisure" || key === "amenity" || key === "shop") return "poi";
  return "other";
}

/** Photon (komoot public instance) — free, keyless, typeahead-friendly. */
export class PhotonGeocodingProvider implements GeocodingProvider {
  readonly name = "Photon";

  async search(query: string, opts?: { limit?: number; near?: LngLat; signal?: AbortSignal }): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(opts?.limit ?? 8), lang: "en" });
    if (opts?.near) {
      params.set("lat", String(opts.near.lat));
      params.set("lon", String(opts.near.lng));
    }
    const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`Photon search failed: ${res.status}`);
    const data = (await res.json()) as {
      features: {
        geometry: { coordinates: [number, number] };
        properties: Record<string, unknown> & {
          name?: string;
          osm_id?: number;
          country?: string;
          state?: string;
          // [west, north, east, south] — NOT GeoJSON bbox order, and NOT a
          // top-level `bbox` field despite that being the GeoJSON norm.
          extent?: [number, number, number, number];
        };
      }[];
    };

    return data.features
      .filter((f) => typeof f.properties.name === "string")
      .map((f) => {
        const props = f.properties;
        const name = String(props.name);
        const labelParts = [name, props.state, props.country].filter(
          (p): p is string => typeof p === "string" && p !== name,
        );
        const extent = props.extent;
        return {
          id: `photon:${props.osm_id ?? `${f.geometry.coordinates.join(",")}`}`,
          name,
          label: [name, ...labelParts].join(", "),
          type: photonTypeFromProperties(props),
          center: { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] },
          bbox: extent ? ([extent[0], extent[3], extent[2], extent[1]] as [number, number, number, number]) : undefined,
          country: typeof props.country === "string" ? props.country : undefined,
          region: typeof props.state === "string" ? props.state : undefined,
        } satisfies SearchResult;
      });
  }
}

function nominatimTypeFromAddresstype(addresstype: string | undefined, class_: string | undefined): PlaceType {
  switch (addresstype) {
    case "country":
      return "country";
    case "state":
    case "region":
      return "region";
    case "city":
      return "city";
    case "town":
      return "town";
    case "village":
    case "hamlet":
      return "village";
    case "road":
      return "street";
    case "house":
    case "building":
      return "address";
    case "peak":
      return "peak";
    case "water":
      return "lake";
  }
  if (class_ === "natural") return "poi";
  return "other";
}

/**
 * Nominatim public instance — fallback only. Hard usage policy limit of
 * 1 request/second, so this provider self-throttles rather than relying on
 * callers to behave.
 */
export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = "Nominatim";
  private lastRequestAt = 0;

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const minInterval = 1100;
    if (elapsed < minInterval) {
      await new Promise((resolve) => setTimeout(resolve, minInterval - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  async search(query: string, opts?: { limit?: number; near?: LngLat; signal?: AbortSignal }): Promise<SearchResult[]> {
    await this.throttle();
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: String(opts?.limit ?? 8),
      addressdetails: "0",
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`Nominatim search failed: ${res.status}`);
    const data = (await res.json()) as {
      place_id: number;
      name: string;
      display_name: string;
      lat: string;
      lon: string;
      addresstype?: string;
      class?: string;
      boundingbox?: [string, string, string, string];
    }[];

    return data.map((r) => ({
      id: `nominatim:${r.place_id}`,
      name: r.name || r.display_name.split(",")[0],
      label: r.display_name,
      type: nominatimTypeFromAddresstype(r.addresstype, r.class),
      center: { lng: Number(r.lon), lat: Number(r.lat) },
      bbox: r.boundingbox
        ? [Number(r.boundingbox[2]), Number(r.boundingbox[0]), Number(r.boundingbox[3]), Number(r.boundingbox[1])]
        : undefined,
    }));
  }
}

/** Tries Photon first (fast, typeahead-friendly); falls back to Nominatim
 * only if Photon errors or returns nothing, since Nominatim's usage policy
 * is much stricter. Caches results per query for the session to avoid
 * repeat calls while the user edits their search. */
export class CompositeGeocodingProvider implements GeocodingProvider {
  readonly name = "Photon+Nominatim";
  private readonly cache = new Map<string, SearchResult[]>();
  private readonly photon = new PhotonGeocodingProvider();
  private readonly nominatim = new NominatimGeocodingProvider();

  async search(query: string, opts?: { limit?: number; near?: LngLat; signal?: AbortSignal }): Promise<SearchResult[]> {
    const cacheKey = `${query.trim().toLowerCase()}|${opts?.limit ?? 8}`;
    const inMemory = this.cache.get(cacheKey);
    if (inMemory) return inMemory;

    // Persistent cache survives app restarts; in-memory (above) just skips
    // the extra IPC round-trip for repeats within the same session.
    const persisted = await cacheGetJson<SearchResult[]>(`geocode:${cacheKey}`);
    if (persisted) {
      this.cache.set(cacheKey, persisted);
      return persisted;
    }

    let results: SearchResult[] = [];
    try {
      results = await this.photon.search(query, opts);
    } catch {
      // fall through to Nominatim
    }
    if (results.length === 0) {
      try {
        results = await this.nominatim.search(query, opts);
      } catch {
        results = [];
      }
    }

    if (results.length > 0) {
      this.cache.set(cacheKey, results);
      void cachePutJson(`geocode:${cacheKey}`, results);
    }
    return results;
  }
}
