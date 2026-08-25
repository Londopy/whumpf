import type { LngLat, LngLatElevation } from "./types";
import { pathLength } from "../geo/distance";
import { withTimeout } from "../net/fetchTimeout";

const REQUEST_TIMEOUT_MS = 20000; // routing calls (esp. round_trip) legitimately take longer than a simple GET

export type RoutingMode = "walking" | "hiking" | "cycling" | "driving" | "manual";

export type WaySurfaceCategory = "trail" | "road" | "other";

export interface WaytypeSegment {
  category: WaySurfaceCategory;
  /** Human label, e.g. "Path", "Track", "Footway", "Steps", "Road". */
  label: string;
  distanceMeters: number;
  /** Share of total route distance, 0-100 (as reported by ORS). */
  percentage: number;
  /** Index range into RouteResult.points this segment covers. */
  startIndex: number;
  endIndex: number;
}

export interface RouteResult {
  points: LngLatElevation[];
  distanceMeters: number;
  ascentMeters?: number;
  descentMeters?: number;
  durationSeconds?: number;
  /** Only populated for ORS-routed results — manual mode has no source for
   * this (no road/trail classification exists for an arbitrary drawn line). */
  waytypeBreakdown?: WaytypeSegment[];
}

/** Routing constraints confirmed against ORS's own API (live test calls,
 * 2026-08-24): avoid_features accepts "steps"/"fords" for foot profiles
 * without a validation error. Deliberately does NOT expose ORS's
 * steepness_difficulty weighting — that parameter is accepted too, but its
 * exact direction/semantics (does a higher value avoid or tolerate steeper
 * terrain?) could not be independently confirmed from documentation alone,
 * and shipping a "avoid steep terrain" toggle whose actual effect is
 * unverified would risk misleading users about what it does. */
export interface RouteConstraints {
  avoidSteps?: boolean;
  avoidFords?: boolean;
}

export interface RoundTripOptions {
  lengthMeters: number;
  /** Number of via-points ORS uses to shape the loop — more points follow
   * the target length more closely but with more turns. ORS default is 5. */
  points?: number;
  /** Fixed seed for reproducible "alternatives" (different seeds produce
   * different real loop shapes of roughly the same target length). */
  seed?: number;
}

/**
 * Calculates a route that follows real trails/roads between waypoints.
 * "manual" mode is always available as a straight-line fallback with no
 * provider/network dependency.
 */
export interface RoutingProvider {
  readonly name: string;
  readonly supportedModes: RoutingMode[];
  route(waypoints: LngLat[], mode: RoutingMode, constraints?: RouteConstraints): Promise<RouteResult>;
}

/** Straight-line routing between waypoints — no network dependency, always
 * available. Ascent/descent are left undefined here (not fabricated); the
 * app fills them in separately from the terrain DEM once a route exists. */
export class ManualRoutingProvider implements RoutingProvider {
  readonly name = "Manual (straight line)";
  readonly supportedModes: RoutingMode[] = ["manual"];

  async route(waypoints: LngLat[], _mode: RoutingMode, _constraints?: RouteConstraints): Promise<RouteResult> {
    return {
      points: waypoints.map((w) => ({ ...w })),
      distanceMeters: pathLength(waypoints),
    };
  }
}

const ORS_PROFILE: Partial<Record<RoutingMode, string>> = {
  walking: "foot-walking",
  hiking: "foot-hiking",
  cycling: "cycling-regular",
  driving: "driving-car",
};

// Confirmed against ORS's own published docs (github.com/GIScience/openrouteservice-docs)
// and cross-checked against a live response before use.
const WAYTYPE_LABELS: Record<number, string> = {
  0: "Unknown",
  1: "State Road",
  2: "Road",
  3: "Street",
  4: "Path",
  5: "Track",
  6: "Cycleway",
  7: "Footway",
  8: "Steps",
  9: "Ferry",
  10: "Construction",
};
const TRAIL_WAYTYPES = new Set([4, 5, 7, 8]); // Path, Track, Footway, Steps
const ROAD_WAYTYPES = new Set([1, 2, 3]); // State Road, Road, Street

function categoryForWaytype(value: number): WaySurfaceCategory {
  if (TRAIL_WAYTYPES.has(value)) return "trail";
  if (ROAD_WAYTYPES.has(value)) return "road";
  return "other";
}

interface OrsGeoJsonResponse {
  features: {
    geometry: { coordinates: [number, number, number?][] };
    properties: {
      summary: { distance: number; duration: number };
      ascent?: number;
      descent?: number;
      extras?: {
        waytype?: {
          values: [number, number, number][];
          summary: { value: number; distance: number; amount: number }[];
        };
      };
    };
  }[];
}

/**
 * OpenRouteService — follows real trails/roads for walking/hiking/cycling/
 * driving. Requires a free personal API key (VITE_ORS_API_KEY). Request/
 * response shape confirmed against ORS's own published OpenAPI spec and a
 * live test call (not assumed): POST /v2/directions/{profile}/geojson with
 * {coordinates, elevation: true, extra_info: ["waytype"]}. ascent/descent
 * come directly from ORS's own routing engine (properties.ascent/descent)
 * rather than being re-derived from point elevations here.
 */
export class OpenRouteServiceProvider implements RoutingProvider {
  readonly name = "OpenRouteService";
  readonly supportedModes: RoutingMode[] = ["walking", "hiking", "cycling", "driving"];

  constructor(private readonly apiKey: string) {}

  private avoidFeaturesFor(constraints?: RouteConstraints): string[] | undefined {
    const features: string[] = [];
    if (constraints?.avoidSteps) features.push("steps");
    if (constraints?.avoidFords) features.push("fords");
    return features.length > 0 ? features : undefined;
  }

  private parseResponse(data: OrsGeoJsonResponse): RouteResult {
    const feature = data.features[0];
    if (!feature) throw new Error("OpenRouteService returned no route");

    const points: LngLatElevation[] = feature.geometry.coordinates.map(([lng, lat, elevation]) => ({
      lng,
      lat,
      elevation,
    }));

    const waytype = feature.properties.extras?.waytype;
    let waytypeBreakdown: WaytypeSegment[] | undefined;
    if (waytype) {
      const distanceByValue = new Map(waytype.summary.map((s) => [s.value, s]));
      waytypeBreakdown = waytype.values.map(([startIndex, endIndex, value]) => {
        const summary = distanceByValue.get(value);
        return {
          category: categoryForWaytype(value),
          label: WAYTYPE_LABELS[value] ?? "Unknown",
          distanceMeters: summary?.distance ?? 0,
          percentage: summary?.amount ?? 0,
          startIndex,
          endIndex,
        };
      });
    }

    return {
      points,
      distanceMeters: feature.properties.summary.distance,
      durationSeconds: feature.properties.summary.duration,
      ascentMeters: feature.properties.ascent,
      descentMeters: feature.properties.descent,
      waytypeBreakdown,
    };
  }

  async route(waypoints: LngLat[], mode: RoutingMode, constraints?: RouteConstraints): Promise<RouteResult> {
    const profile = ORS_PROFILE[mode];
    if (!profile) throw new Error(`OpenRouteService does not support routing mode "${mode}"`);

    const avoidFeatures = this.avoidFeaturesFor(constraints);
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({
        coordinates: waypoints.map((w) => [w.lng, w.lat]),
        elevation: true,
        extra_info: ["waytype"],
        ...(avoidFeatures ? { options: { avoid_features: avoidFeatures } } : {}),
      }),
      signal: withTimeout(undefined, REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const rateLimited = res.status === 429 ? " (rate limited — you've hit ORS's free-tier request limit, try again shortly)" : "";
      throw new Error(`OpenRouteService request failed: ${res.status}${rateLimited} ${body.slice(0, 200)}`);
    }
    return this.parseResponse((await res.json()) as OrsGeoJsonResponse);
  }

  /**
   * Generates a loop starting and ending at `start`, approximately
   * `opts.lengthMeters` long — ORS's own round_trip optimisation, confirmed
   * live (2026-08-24): a 5000m target produced a real ~6565m loop with
   * real ascent/descent from actual trail/road geometry, not a synthetic
   * circle. ORS treats the target length as approximate, not exact — the
   * caller should present the result's actual distanceMeters, not assume
   * it matches the request.
   */
  async roundTrip(start: LngLat, opts: RoundTripOptions, mode: RoutingMode, constraints?: RouteConstraints): Promise<RouteResult> {
    const profile = ORS_PROFILE[mode];
    if (!profile) throw new Error(`OpenRouteService does not support routing mode "${mode}"`);

    const avoidFeatures = this.avoidFeaturesFor(constraints);
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({
        coordinates: [[start.lng, start.lat]],
        elevation: true,
        extra_info: ["waytype"],
        options: {
          round_trip: { length: opts.lengthMeters, points: opts.points ?? 5, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) },
          ...(avoidFeatures ? { avoid_features: avoidFeatures } : {}),
        },
      }),
      signal: withTimeout(undefined, REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const rateLimited = res.status === 429 ? " (rate limited — you've hit ORS's free-tier request limit, try again shortly)" : "";
      throw new Error(`OpenRouteService round-trip request failed: ${res.status}${rateLimited} ${body.slice(0, 200)}`);
    }
    return this.parseResponse((await res.json()) as OrsGeoJsonResponse);
  }
}

/** Routes through ORS for its supported modes, manual straight-line
 * otherwise — a single provider the route editor can call regardless of
 * which mode is currently selected. */
export class CompositeRoutingProvider implements RoutingProvider {
  readonly name = "OpenRouteService + Manual";
  readonly supportedModes: RoutingMode[];
  private readonly manual = new ManualRoutingProvider();
  private readonly ors: OpenRouteServiceProvider | null;

  constructor(orsApiKey: string | undefined) {
    this.ors = orsApiKey ? new OpenRouteServiceProvider(orsApiKey) : null;
    this.supportedModes = this.ors ? [...this.ors.supportedModes, "manual"] : ["manual"];
  }

  get hasOrs(): boolean {
    return this.ors !== null;
  }

  /** Round-trip/loop generation needs a real road/trail network — only
   * available when an ORS key is configured; there is no manual-mode
   * equivalent (a "loop" with no network to follow is undefined). */
  get hasRoundTrip(): boolean {
    return this.ors !== null;
  }

  async route(waypoints: LngLat[], mode: RoutingMode, constraints?: RouteConstraints): Promise<RouteResult> {
    if (mode === "manual" || !this.ors) return this.manual.route(waypoints, mode, constraints);
    return this.ors.route(waypoints, mode, constraints);
  }

  async roundTrip(start: LngLat, opts: RoundTripOptions, mode: RoutingMode, constraints?: RouteConstraints): Promise<RouteResult> {
    if (!this.ors) throw new Error("Loop routes need a free OpenRouteService API key — not configured yet");
    return this.ors.roundTrip(start, opts, mode, constraints);
  }
}
