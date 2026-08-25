/** Cross-boundary contract check.
 *
 * The Python endpoint and the TypeScript client agree on a payload shape by
 * convention, not by any shared schema -- nothing would catch it if one side
 * drifted. So this feeds a *real* response, captured from the running Flask
 * app, through the *real* client parser and asserts the result is usable.
 *
 * Regenerate the captured response with:
 *   PYTHONPATH=. python3 -c "..."   (see the port commit message)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkiLiftProperties, parseSkiRunProperties } from "../src/providers/SkiDataProvider";
import { pathLength } from "../src/geo/distance";

// Resolved from the package root, not import.meta.url -- the bundle runs
// out of node_modules/.cache, so the module's own location is not the
// project layout.
const raw = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures-endpoint-response.json"), "utf8"),
);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
  if (!ok) failures++;
};

check("response is a FeatureCollection", raw.type === "FeatureCollection");
check("carries attribution", typeof raw.attribution === "string" && raw.attribution.length > 0);
check("reports counts", raw.counts.runs === 2 && raw.counts.lifts === 2 && raw.counts.trails === 2,
  JSON.stringify(raw.counts));

const feats = raw.features as any[];
check("every feature is a LineString with >= 2 points",
  feats.every((f) => f.geometry.type === "LineString" && f.geometry.coordinates.length >= 2));

// Coordinates must be [lng, lat]. Craigieburn is ~171E / ~-43S; a swap puts
// every feature in the Southern Ocean without erroring anywhere.
check("coordinates are [lng, lat]",
  feats.every((f) => {
    const [lng, lat] = f.geometry.coordinates[0];
    return lng > 170 && lng < 173 && lat < -42 && lat > -44;
  }));

// The real point: his parsers, unmodified, on the server's real output.
const runs = feats.filter((f) => f.properties.kind === "runs");
const parsedRuns = runs.map((f) => ({
  ...parseSkiRunProperties(f.id, f.properties),
  geometry: f.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lng, lat })),
}));
check("client parser reads every run's difficulty",
  parsedRuns.every((r) => typeof r.difficulty === "string"));
check("a tagged run keeps its difficulty",
  parsedRuns.some((r) => r.difficulty === "advanced"),
  parsedRuns.map((r) => r.difficulty).join(","));
check("an untagged run is 'unknown', not invented",
  parsedRuns.some((r) => r.difficulty === "unknown"));
check("every run gets a colour", parsedRuns.every((r) => !!r.color));
check("run geometry measures to a sane length",
  parsedRuns.every((r) => {
    const m = pathLength(r.geometry);
    return m > 10 && m < 50_000;
  }),
  parsedRuns.map((r) => Math.round(pathLength(r.geometry)) + "m").join(", "));

const lifts = feats.filter((f) => f.properties.kind === "lifts");
const parsedLifts = lifts.map((f) => parseSkiLiftProperties(f.id, f.properties));
check("client parser types every lift",
  parsedLifts.every((l) => l.liftType !== undefined));
check("t-bar is typed as a drag lift",
  parsedLifts.some((l) => l.liftType === "drag"),
  parsedLifts.map((l) => l.liftType).join(","));
check("chair_lift is typed as a chairlift",
  parsedLifts.some((l) => l.liftType === "chairlift"));

console.log(failures === 0 ? "\nCONTRACT OK" : `\n${failures} CONTRACT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
