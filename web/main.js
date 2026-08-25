// Widget CSS from the installed package, not a CDN -- keeps it locked to
// whatever version npm actually resolved.
import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { createAttributeMaterial, hexToVec3, setUniforms } from "./attributeMaterial.js";
import { makeTestAttributeTile } from "./testTile.js";

// Ported from contour-map (kiy-codes), rewritten for Cesium. See
// PORTING-STATUS.md.
import { AoiFeatureProvider } from "./src/providers/AoiFeatureProvider.ts";
import { CesiumElevationProvider } from "./src/providers/ElevationProvider.ts";
import { SkiLayer } from "./src/cesium/skiLayer.ts";
import { AoiTrailSource } from "./src/cesium/aoiTrailSource.ts";
import { Graticule } from "./src/cesium/graticule.ts";
import { LayersPanel } from "./src/ui/layersPanel.ts";
import { FeatureInfoPanel } from "./src/ui/featureInfo.ts";

const API = import.meta.env?.VITE_API_URL ?? "http://localhost:5000";
Cesium.Ion.defaultAccessToken = import.meta.env?.VITE_ION_TOKEN ?? "";

const OCTANTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const state = {
  aois: [],
  aoi: null,
  bulletin: null,
  problemIndex: 0,
  mode: 1,
  manual: { mask: 0, slopeMin: 30, slopeMax: 50, elevMin: 0, elevMax: 4000 },
  opacity: 0.65,
};

let viewer;
let material;

// Ported layers. Rebuilt per AOI, since every one of them is AOI-scoped.
const featureProvider = new AoiFeatureProvider(API);
let skiLayer = null;
let trailSource = null;
let graticule = null;
let layersPanel = null;
let infoPanel = null;
let elevationProvider = null;
// Toggle state survives an AOI change -- if you had runs on for one range,
// you almost certainly want them on for the next.
const layerState = { runs: false, lifts: false, trails: false, grid: false };

// --- scene ---------------------------------------------------------------

async function initViewer() {
  viewer = new Cesium.Viewer("cesium", {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    fullscreenButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    infoBox: false,
    selectionIndicator: false,
    // World Terrain is a placeholder until the AOI's ion asset exists.
    terrainProvider: await Cesium.createWorldTerrainAsync(),
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.fog.enabled = true;
  viewer.scene.skyAtmosphere.show = true;

  material = createAttributeMaterial(makeTestAttributeTile());

  elevationProvider = new CesiumElevationProvider(() => viewer);
  graticule = new Graticule(viewer, { showLabels: true });
  infoPanel = new FeatureInfoPanel(
    document.getElementById("feature-info"),
    elevationProvider
  );
}

async function loadTerrainForAoi(aoi) {
  if (!aoi.ion_asset_id) return; // still on World Terrain
  try {
    viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(
      aoi.ion_asset_id
    );
  } catch (e) {
    console.warn("ion terrain unavailable, staying on World Terrain", e);
  }
}

function flyToAoi(aoi) {
  const [w, s, e, n] = aoi.bbox;
  // Low oblique looking across the range rather than straight down.
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      (w + e) / 2,
      s - (n - s) * 0.55,
      4200
    ),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-22),
      roll: 0,
    },
    duration: 2.0,
  });
}

// --- data ----------------------------------------------------------------

async function loadAois() {
  state.aois = await fetch(`${API}/api/aois`).then((r) => r.json());
  const sel = document.getElementById("aoi");
  sel.innerHTML = state.aois
    .map((a) => `<option value="${a.slug}">${a.name}</option>`)
    .join("");
  sel.onchange = () => selectAoi(sel.value);
  await selectAoi(state.aois[0].slug);
}

async function selectAoi(slug) {
  state.aoi = state.aois.find((a) => a.slug === slug);
  await loadTerrainForAoi(state.aoi);
  flyToAoi(state.aoi);
  await loadBulletin(slug);
  await rebuildLayers(slug);
  renderAll();
}

// --- ported layers -------------------------------------------------------

/** Tears down the previous AOI's layers and builds the new one's.
 *
 * Features are fetched per AOI and cached server-side for a day (Overpass is
 * a shared, rate-limited service), so this is a cheap call after the first
 * visit to a given range. */
async function rebuildLayers(slug) {
  if (skiLayer) skiLayer.disable();
  if (trailSource) trailSource.clear();
  infoPanel.clear();

  skiLayer = new SkiLayer(viewer, featureProvider, slug, (selection) => {
    void infoPanel.show(selection);
  });
  trailSource = new AoiTrailSource(featureProvider);

  if (!layersPanel) {
    layersPanel = new LayersPanel(document.getElementById("pane-layers"), [
      {
        id: "runs",
        label: "Ski runs",
        initial: layerState.runs,
        note: "OpenStreetMap piste data for this area.",
        onChange: (on) => {
          layerState.runs = on;
          void skiLayer.setEnabled(on || layerState.lifts);
          skiLayer.setOptions({ showRuns: on, showLifts: layerState.lifts });
        },
      },
      {
        id: "lifts",
        label: "Lifts",
        initial: layerState.lifts,
        onChange: (on) => {
          layerState.lifts = on;
          void skiLayer.setEnabled(on || layerState.runs);
          skiLayer.setOptions({ showRuns: layerState.runs, showLifts: on });
        },
      },
      {
        id: "trails",
        label: "Snap routes to trails",
        initial: layerState.trails,
        note: "Loads approach tracks so waypoints snap to them.",
        onChange: (on) => {
          layerState.trails = on;
          if (on) void trailSource.load(state.aoi.slug).catch(() => {});
          else trailSource.clear();
        },
      },
      {
        id: "grid",
        label: "Lat/lng grid",
        initial: layerState.grid,
        onChange: (on) => {
          layerState.grid = on;
          graticule.setEnabled(on);
        },
      },
    ]);
  }

  // Re-apply whatever was toggled on for the previous AOI.
  if (layerState.runs || layerState.lifts) {
    await skiLayer.setEnabled(true);
    skiLayer.setOptions({ showRuns: layerState.runs, showLifts: layerState.lifts });
  }
  if (layerState.trails) {
    await trailSource.load(slug).catch(() => {});
  }
}

async function loadBulletin(slug) {
  try {
    state.bulletin = await fetch(`${API}/api/bulletin?aoi=${slug}`).then((r) => r.json());
    state.problemIndex = 0;
  } catch (e) {
    console.error("bulletin fetch failed", e);
    state.bulletin = null;
  }
}

// --- render --------------------------------------------------------------

function renderStaleness() {
  const el = document.getElementById("staleness");
  const b = state.bulletin;
  if (!b) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (b.is_stale) {
    el.textContent = "EXPIRED BULLETIN";
    el.className = "badge";
  } else if (b.is_fixture) {
    el.textContent = "ARCHIVED BULLETIN";
    el.className = "badge";
  } else {
    el.textContent = "LIVE";
    el.className = "badge live";
  }
}

function renderBulletinPane() {
  const b = state.bulletin;
  const dangerEl = document.getElementById("danger");
  const tabsEl = document.getElementById("problem-tabs");
  const detailEl = document.getElementById("problem-detail");

  if (!b) {
    dangerEl.textContent = "No bulletin available.";
    tabsEl.innerHTML = detailEl.innerHTML = "";
    return;
  }

  dangerEl.style.background = b.danger.color;
  dangerEl.style.color = b.danger.max >= 4 ? "#fff" : "#1a1206";
  dangerEl.innerHTML = `
    <div class="rating">${b.danger.max} &middot; ${b.danger.label}</div>
    <div class="band">Upper ${b.danger.upper} &nbsp; Middle ${b.danger.middle} &nbsp; Lower ${b.danger.lower}</div>`;

  tabsEl.innerHTML = b.problems
    .map(
      (p, i) =>
        `<button data-i="${i}" class="${i === state.problemIndex ? "active" : ""}">${p.type}</button>`
    )
    .join("");
  tabsEl.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      state.problemIndex = +btn.dataset.i;
      renderAll();
    };
  });

  const p = b.problems[state.problemIndex];
  if (!p) {
    detailEl.innerHTML = "<p>No avalanche problems listed.</p>";
    return;
  }
  detailEl.innerHTML = `
    <dl>
      <dt>Likelihood</dt><dd>${p.likelihood}</dd>
      <dt>Size</dt><dd>${p.size[0]}–${p.size[1]}</dd>
      <dt>Aspects</dt><dd>${p.aspects.join(", ")}</dd>
      <dt>Elevation</dt><dd>${p.elev_min_m}–${p.elev_max_m} m</dd>
      <dt>Slope</dt><dd>${p.slope_min}–${p.slope_max}°</dd>
    </dl>
    ${p.comment ? `<p>${p.comment}</p>` : ""}`;
}

function renderAttribution() {
  const b = state.bulletin;
  const el = document.getElementById("attribution");
  const sources = "Terrain: USGS 3DEP / LINZ · Imagery: Copernicus Sentinel-2";
  if (!b) {
    el.innerHTML = sources;
    return;
  }
  el.innerHTML = `
    Bulletin: <a class="src" href="${b.source.url}" target="_blank" rel="noopener">${b.source.name}</a><br>
    Issued ${b.issued || "unknown"} · Expires ${b.expires || "unknown"}
    ${b.is_stale ? " · <strong>EXPIRED</strong>" : ""}<br>
    ${sources}`;
}

function applyUniforms() {
  const b = state.bulletin;
  let u = { u_mode: state.mode, u_opacity: state.opacity };

  if (state.mode === 2 && b?.problems?.[state.problemIndex]) {
    const p = b.problems[state.problemIndex];
    u = {
      ...u,
      u_aspectMask: p.aspect_mask,
      u_slopeMin: p.slope_min,
      u_slopeMax: p.slope_max,
      u_elevMin: p.elev_min_m,
      u_elevMax: p.elev_max_m,
      // Expired bulletins render grey, never in danger colours.
      u_dangerColor: hexToVec3(b.is_stale ? "#8b979e" : b.danger.color),
    };
  } else if (state.mode === 3) {
    const m = state.manual;
    u = {
      ...u,
      u_aspectMask: m.mask,
      u_slopeMin: m.slopeMin,
      u_slopeMax: m.slopeMax,
      u_elevMin: m.elevMin,
      u_elevMax: m.elevMax,
      u_dangerColor: hexToVec3("#4aa8d8"),
    };
  }

  setUniforms(material, u);
}

function renderAll() {
  renderStaleness();
  renderBulletinPane();
  renderAttribution();
  applyUniforms();
}

// --- controls ------------------------------------------------------------

function initControls() {
  document.querySelectorAll(".modes button").forEach((btn) => {
    btn.onclick = () => {
      state.mode = +btn.dataset.mode;
      document.querySelectorAll(".modes button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("pane-slope").hidden = state.mode !== 1;
      document.getElementById("pane-bulletin").hidden = state.mode !== 2;
      document.getElementById("pane-manual").hidden = state.mode !== 3;
      applyUniforms();
    };
  });

  const oct = document.getElementById("octants");
  oct.innerHTML = OCTANTS.map((o, i) => `<button data-bit="${i}">${o}</button>`).join("");
  oct.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const bit = 1 << +btn.dataset.bit;
      state.manual.mask ^= bit;
      btn.classList.toggle("on", (state.manual.mask & bit) !== 0);
      applyUniforms();
    };
  });

  const bind = (id, key, fmt) => {
    document.getElementById(id).oninput = (e) => {
      state.manual[key] = +e.target.value;
      fmt();
      applyUniforms();
    };
  };
  const slopeOut = () => {
    document.getElementById("slope-out").textContent =
      `${state.manual.slopeMin}–${state.manual.slopeMax}°`;
  };
  const elevOut = () => {
    document.getElementById("elev-out").textContent =
      `${state.manual.elevMin}–${state.manual.elevMax} m`;
  };
  bind("slope-min", "slopeMin", slopeOut);
  bind("slope-max", "slopeMax", slopeOut);
  bind("elev-min", "elevMin", elevOut);
  bind("elev-max", "elevMax", elevOut);

  document.getElementById("opacity").oninput = (e) => {
    state.opacity = +e.target.value;
    document.getElementById("opacity-out").textContent = state.opacity.toFixed(2);
    applyUniforms();
  };

  document.getElementById("disclaimer-ok").onclick = () => {
    document.getElementById("disclaimer").hidden = true;
  };
}

// --- boot ----------------------------------------------------------------

(async function main() {
  await initViewer();
  initControls();
  await loadAois();
})();
