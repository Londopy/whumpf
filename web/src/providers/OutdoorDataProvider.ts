/** Hiking/walking trail data description, ported from contour-map (kiy-codes).
 *
 * The original carried a `trailFilter: FilterSpecification` -- a MapLibre
 * filter expression -- because trails were read straight out of the
 * "openmaptiles" vector source the base map style already loaded, costing no
 * extra network round trip.
 *
 * Cesium renders imagery as rasters and holds no vector features, so there is
 * no source to filter and no expression language to filter it with. The
 * filter therefore becomes an ordinary predicate over feature properties:
 * the same selection rule, expressed so that whatever ends up supplying
 * geometry (an Overpass query, a trails endpoint on whumpf's Flask API, or a
 * future vector-tile decoder) can apply it without a map engine involved.
 */
import type { AttributionEntry } from "./types";

export type TrailType = "footpath" | "hiking" | "long-distance" | "bridleway" | "track";

/** Feature properties as they arrive from OSM-derived sources. */
export type TrailProperties = Record<string, unknown>;

export interface OutdoorDataProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  /** Retained for parity with the MapLibre build's source bookkeeping and
   * for any future vector-tile path; unused by the Cesium renderer. */
  readonly vectorSourceId: string;
  readonly sourceLayer: string;
  /** Selects hiking/walking-relevant ways. Engine-agnostic replacement for
   * the MapLibre filter expression. */
  matchesTrail(properties: TrailProperties): boolean;
}

/**
 * Selects hiking/walking paths and tracks by OSM `class`.
 *
 * Verified against the live OpenFreeMap style JSON: `class` values include
 * "path", "track", and "pedestrian" -- no finer OSM-tag subclass is
 * populated in that tileset, so this is the finest filter available without
 * a second data source. The rule is unchanged from the MapLibre expression
 * `["match", ["get","class"], ["path","track"], true, false]`.
 */
export class OsmTransportationOutdoorProvider implements OutdoorDataProvider {
  readonly name = "OpenStreetMap (via base map vector tiles)";
  readonly attribution: AttributionEntry = {
    html: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  };
  readonly vectorSourceId = "openmaptiles";
  readonly sourceLayer = "transportation";

  matchesTrail(properties: TrailProperties): boolean {
    const cls = properties.class;
    return cls === "path" || cls === "track";
  }
}
