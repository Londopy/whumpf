/** Headless DOM checks for the ported UI.
 *
 * The Cesium layers need WebGL and cannot run here, but LayersPanel and
 * FeatureInfoPanel are ordinary DOM construction, so they can be exercised
 * against linkedom. That covers the wiring most likely to be quietly wrong:
 * toggle -> controller plumbing, status rendering, and the elevation
 * "unknown vs zero" rule that matters on an avalanche tool.
 */
import { parseHTML } from "linkedom";

// Take Event from linkedom's window, not Node's global -- Node ships its own
// Event whose eventPhase is getter-only, and linkedom's dispatchEvent writes
// to it.
const { document, HTMLElement, Event } = parseHTML(
  "<!doctype html><html><body></body></html>",
);
// The modules construct elements via the globals, as they do in a browser.
(globalThis as any).document = document;
(globalThis as any).HTMLElement = HTMLElement;

const { LayersPanel } = await import("../src/ui/layersPanel");
const { FeatureInfoPanel } = await import("../src/ui/featureInfo");
const { LayerController } = await import("../src/cesium/layerController");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
  if (!ok) failures++;
};

// A controller that records calls instead of touching a globe.
class FakeLayer extends (LayerController as any) {
  attached = 0;
  detached = 0;
  shouldFail = false;
  protected async attach(): Promise<void> {
    this.attached++;
    if (this.shouldFail) throw new Error("upstream exploded");
    this.setState({ status: "ready", count: 42, fetchedAt: Date.now() });
  }
  protected detach(): void {
    this.detached++;
  }
}

// --- LayersPanel -----------------------------------------------------------

const root = document.createElement("section");
const layer = new FakeLayer();
let toggled: boolean | null = null;

const panel = new LayersPanel(root as any, [
  { id: "runs", label: "Ski runs", controller: layer as any, note: "OSM piste data." },
  { id: "grid", label: "Lat/lng grid", onChange: (on: boolean) => (toggled = on) },
]);

check("renders a row per toggle", root.querySelectorAll(".layer-row").length === 2);
check("renders the note", (root.querySelector(".layer-note") as any)?.textContent === "OSM piste data.");

const runsInput = root.querySelector("#layer-runs") as any;
const runsStatus = root.querySelector("#layer-status-runs") as any;
check("starts unchecked", runsInput.checked === false);
check("status starts empty", runsStatus.textContent === "");

runsInput.checked = true;
runsInput.dispatchEvent(new Event("change"));
await new Promise((r) => setTimeout(r, 0));

check("toggling on enables the controller", layer.attached === 1, `attached=${layer.attached}`);
check("ready status shows the feature count", runsStatus.textContent === "42", runsStatus.textContent);

runsInput.checked = false;
runsInput.dispatchEvent(new Event("change"));
await new Promise((r) => setTimeout(r, 0));
check("toggling off disables the controller", layer.detached === 1, `detached=${layer.detached}`);
check("status clears on disable", runsStatus.textContent === "");

// A controller-less toggle still fires its callback.
const gridInput = root.querySelector("#layer-grid") as any;
gridInput.checked = true;
gridInput.dispatchEvent(new Event("change"));
check("controller-less toggle fires onChange", toggled === true);

// An empty area should read as "none here", not as a failure.
const empty = new FakeLayer();
(empty as any).attach = async function () {
  this.setState({ status: "ready", count: 0, fetchedAt: Date.now() });
};
const root2 = document.createElement("section");
new LayersPanel(root2 as any, [{ id: "x", label: "X", controller: empty as any }]);
const xInput = root2.querySelector("#layer-x") as any;
xInput.checked = true;
xInput.dispatchEvent(new Event("change"));
await new Promise((r) => setTimeout(r, 0));
check("an AOI with no features reads 'none here', not an error",
  (root2.querySelector("#layer-status-x") as any).textContent === "none here");

// A failing layer must not take the app down.
const bad = new FakeLayer();
bad.shouldFail = true;
const root3 = document.createElement("section");
new LayersPanel(root3 as any, [{ id: "b", label: "B", controller: bad as any }]);
const bInput = root3.querySelector("#layer-b") as any;
bInput.checked = true;
bInput.dispatchEvent(new Event("change"));
await new Promise((r) => setTimeout(r, 10));
const bStatus = root3.querySelector("#layer-status-b") as any;
check("a failing layer surfaces as 'failed' and does not throw",
  bStatus.textContent === "failed", bStatus.textContent);

panel.destroy();
check("destroy empties the panel", root.innerHTML === "");

// --- FeatureInfoPanel ------------------------------------------------------

const infoRoot = document.createElement("div");
const run = {
  id: "run/1",
  name: "Middle Basin",
  difficulty: "advanced" as const,
  color: "#111827",
  lengthMeters: 1420,
  geometry: [
    { lng: 171.718, lat: -43.142 },
    { lng: 171.721, lat: -43.145 },
  ],
};

// Terrain not loaded: getElevation returns null. Must render an em dash,
// never 0 m -- a fabricated elevation on an avalanche tool is worse than a
// blank.
const nullElevation = {
  getElevation: async () => null,
  getElevationProfile: async () => [],
};
const info = new FeatureInfoPanel(infoRoot as any, nullElevation as any);
check("info panel starts hidden", infoRoot.hidden === true);

await info.show({ kind: "run", run } as any);
check("shows the run name", infoRoot.innerHTML.includes("Middle Basin"));
check("formats length in km", infoRoot.innerHTML.includes("1.42 km"));
const startCell = infoRoot.querySelector("[data-field=start-elev]") as any;
check("unknown elevation renders as a dash, not 0 m", startCell.textContent === "—",
  startCell.textContent);

// With terrain loaded it should show real values and a computed vertical.
const realElevation = {
  getElevation: async (p: any) => (p.lat === -43.142 ? 1840 : 1520),
  getElevationProfile: async () => [],
};
const info2 = new FeatureInfoPanel(infoRoot as any, realElevation as any);
await info2.show({ kind: "run", run } as any);
check("renders real top elevation",
  (infoRoot.querySelector("[data-field=start-elev]") as any).textContent === "1840 m");
check("computes vertical drop",
  (infoRoot.querySelector("[data-field=drop]") as any).textContent === "320 m",
  (infoRoot.querySelector("[data-field=drop]") as any).textContent);

// Escaping: OSM names are user-supplied data.
const nasty = { ...run, name: '<img src=x onerror="alert(1)">' };
await info2.show({ kind: "run", run: nasty } as any);
check("escapes names from OSM", !infoRoot.innerHTML.includes("<img src=x"));

info2.clear();
check("clear hides the panel", infoRoot.hidden === true);

console.log(failures === 0 ? "\nUI CHECKS PASSED" : `\n${failures} UI CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
