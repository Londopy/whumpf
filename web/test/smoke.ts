import { buildGpxXml } from "../src/gpx/gpxExport";
import { parseGpx } from "../src/gpx/gpxImport";
import { haversineDistance, pathLength, resampleLine } from "../src/geo/distance";
import { estimateDifficulty } from "../src/routing/routeDifficulty";
import { Observable } from "../src/cesium/layerController";
import { DOMParser as LinkeDOMParser } from "linkedom";

// parseGpx uses the browser's DOMParser. Fine in the app; in Node it needs a
// shim, which is worth knowing if you ever want these under CI.
(globalThis as any).DOMParser = LinkeDOMParser;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
  if (!ok) failures++;
};

// Chamonix valley, real coordinates.
const pts = [
  { lng: 6.8650, lat: 45.8326 },
  { lng: 6.8700, lat: 45.8350 },
  { lng: 6.8750, lat: 45.8400 },
];

// 1. Haversine against an independently computed great-circle distance.
const d01 = haversineDistance(pts[0], pts[1]);
const R = 6371008.8;
const toRad = (x: number) => (x * Math.PI) / 180;
const dLat = toRad(pts[1].lat - pts[0].lat), dLng = toRad(pts[1].lng - pts[0].lng);
const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(pts[0].lat)) * Math.cos(toRad(pts[1].lat)) * Math.sin(dLng / 2) ** 2;
const expected = 2 * R * Math.asin(Math.sqrt(a));
check("haversineDistance matches independent formula", Math.abs(d01 - expected) < 1.0,
  `got ${d01.toFixed(1)}m, expected ~${expected.toFixed(1)}m`);

// 2. pathLength is the sum of its legs.
const total = pathLength(pts);
const legSum = haversineDistance(pts[0], pts[1]) + haversineDistance(pts[1], pts[2]);
check("pathLength == sum of legs", Math.abs(total - legSum) < 0.01, `${total.toFixed(1)}m`);

// 3. GPX round trip: export, re-parse, compare coordinates.
const xml = buildGpxXml({ routeName: "smoke", trackPoints: pts.map((p) => ({ ...p })) });
check("buildGpxXml emits trkpt", xml.includes("<trkpt"), `${xml.length} bytes`);
const parsed = parseGpx(xml);
const rt = parsed.points ?? [];
check("round trip preserves point count", rt.length === pts.length, `${rt.length} of ${pts.length}`);
if (rt.length === pts.length) {
  const drift = Math.max(...pts.map((p, i) =>
    Math.max(Math.abs(p.lng - rt[i]!.lng), Math.abs(p.lat - rt[i]!.lat))));
  check("round trip coordinate drift < 1e-6 deg", drift < 1e-6, `max ${drift}`);
}

// 4. resampleLine returns the requested count and keeps the endpoints.
const rs = resampleLine(pts, 10);
check("resampleLine honours sample count", rs.length === 10, `${rs.length}`);
check("resampleLine keeps first point",
  Math.abs(rs[0]!.lng - pts[0].lng) < 1e-9 && Math.abs(rs[0]!.lat - pts[0].lat) < 1e-9);

// 5. Difficulty ordering: more ascent over the same distance is never easier.
const rank = { easy: 0, moderate: 1, hard: 2, strenuous: 3 } as const;
const flat = estimateDifficulty(5000, 50, 5);
const steep = estimateDifficulty(5000, 1200, 35);
check("difficulty is monotonic in ascent", rank[steep.level] >= rank[flat.level],
  `${flat.level} -> ${steep.level}`);

// 6. Observable: fires on change, bails on identical value (React parity).
const obs = new Observable(1);
let fired = 0;
const unsub = obs.subscribe(() => fired++);
check("subscribe delivers initial value", fired === 1);
obs.set(1);
check("set with same value does not fire", fired === 1);
obs.set(2);
check("set with new value fires", fired === 2);
unsub();
obs.set(3);
check("unsubscribe stops delivery", fired === 2);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
