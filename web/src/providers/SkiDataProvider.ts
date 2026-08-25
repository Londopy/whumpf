import type { AttributionEntry, LngLat } from "./types";

// Canonical OpenSkiMap/OSM piste:difficulty values, confirmed against their
// live tile data and app bundle — "unknown" is ours, for when the tag is
// simply absent (never invent a difficulty that isn't tagged).
export type PisteDifficulty =
  | "novice"
  | "easy"
  | "intermediate"
  | "advanced"
  | "expert"
  | "freeride"
  | "extreme"
  | "other"
  | "unknown";

export type LiftType = "gondola" | "chairlift" | "drag" | "cable-car" | "magic-carpet" | "other";

export interface SkiRun {
  id: string;
  name?: string;
  difficulty: PisteDifficulty;
  /** Pre-computed by OpenSkiMap for exactly this difficulty (CSS color string). */
  color?: string;
  /** Computed from the real LineString geometry (haversine sum) — not from a data field. */
  lengthMeters?: number;
  /** undefined = not yet queried, null = queried but unavailable (e.g. terrain off), number = real value. */
  startElevation?: number | null;
  endElevation?: number | null;
  geometry: LngLat[];
}

export interface SkiLift {
  id: string;
  /** OpenSkiMap combines name + lift type, e.g. "Matterhorn Express (8p Gondola)". */
  nameAndType?: string;
  liftType: LiftType;
  status?: string;
  color?: string;
  /** undefined = not yet queried, null = queried but unavailable (e.g. terrain off), number = real value. */
  startElevation?: number | null;
  endElevation?: number | null;
  geometry: LngLat[];
}

/**
 * OpenSkiMap.org's public vector tile service — OSM-derived ski area/run/
 * lift data, refreshed daily upstream. Confirmed live via their own style
 * JSON + a direct .pbf fetch/decode (not guessed): tiles at
 * tiles.openskimap.org/openskimap/{z}/{x}/{y}.pbf, source-layers
 * "runs" | "lifts" | "skiareas" | "spots", zoom 0-15.
 */
export interface SkiDataProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  readonly tileUrlTemplate: string;
  readonly minzoom: number;
  readonly maxzoom: number;
}

export class OpenSkiMapProvider implements SkiDataProvider {
  readonly name = "OpenSkiMap.org";
  readonly attribution: AttributionEntry = {
    html: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, <a href="https://openskimap.org" target="_blank" rel="noreferrer">OpenSkiMap.org</a>',
  };
  readonly tileUrlTemplate = "https://tiles.openskimap.org/openskimap/{z}/{x}/{y}.pbf";
  readonly minzoom = 0;
  readonly maxzoom = 15;
}

function normalizeDifficulty(value: unknown): PisteDifficulty {
  const known: PisteDifficulty[] = ["novice", "easy", "intermediate", "advanced", "expert", "freeride", "extreme", "other"];
  return typeof value === "string" && (known as string[]).includes(value) ? (value as PisteDifficulty) : "unknown";
}

/** Best-effort lift type from OpenSkiMap's "Name (Type)" convention — the
 * type itself comes from real OSM aerialway/lift tags, this just extracts
 * it from the formatted string since the tile doesn't expose it separately. */
function parseLiftType(nameAndType: string | undefined): LiftType {
  if (!nameAndType) return "other";
  const paren = /\(([^)]+)\)\s*$/.exec(nameAndType)?.[1]?.toLowerCase() ?? nameAndType.toLowerCase();
  if (paren.includes("gondola")) return "gondola";
  if (paren.includes("cable car") || paren.includes("tram")) return "cable-car";
  if (paren.includes("carpet")) return "magic-carpet";
  if (paren.includes("drag") || paren.includes("t-bar") || paren.includes("button") || paren.includes("platter")) return "drag";
  if (paren.includes("chair") || paren.includes("quad") || paren.includes("triple") || paren.includes("double") || paren.includes("6p") || paren.includes("8p"))
    return "chairlift";
  return "other";
}

export function parseSkiRunProperties(id: string, props: Record<string, unknown>): Omit<SkiRun, "geometry"> {
  return {
    id,
    name: typeof props.name === "string" ? props.name : undefined,
    difficulty: normalizeDifficulty(props.difficulty),
    color: typeof props.color === "string" ? props.color : undefined,
  };
}

export function parseSkiLiftProperties(id: string, props: Record<string, unknown>): Omit<SkiLift, "geometry"> {
  const nameAndType = typeof props.name_and_type === "string" ? props.name_and_type : undefined;
  return {
    id,
    nameAndType,
    liftType: parseLiftType(nameAndType),
    status: typeof props.status === "string" ? props.status : undefined,
    color: typeof props.color === "string" ? props.color : undefined,
  };
}
