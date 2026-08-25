// Keeps a small, permanent, low-zoom satellite tile set cached for the
// whole world, so MapLibre always has *something* to show as a placeholder
// the instant you land somewhere new (a fast pan, a big zoom-out, a search
// result on the other side of the planet) — instead of a transparent gap
// (verified live: an unloaded tile renders as (0,0,0,0), not literally a
// white texture; what shows through depends on the app's background behind
// the canvas) while the real, sharp tile is still in flight.
//
// Reuses the existing offline-region download engine (downloadManager.ts)
// wholesale rather than writing a parallel fetch/concurrency/persistence
// path — this "region" just happens to be the whole world at a shallow,
// fixed zoom range. That also means it's resumable, retried, and visible
// (and deletable, if the user wants the space back) in the same Downloaded
// Regions manager as any region the user draws themselves.
import { createRegion, getRegion, type OfflineRegion } from "../cache/persistentCache";
import { startRegionDownload, resumeRegionDownload } from "./downloadManager";
import type { Bbox } from "./regionTiles";

export const WORLD_OVERVIEW_REGION_ID = "world-overview-satellite";
// Mercator-valid world bounds (±85.05° is the standard Web Mercator clip,
// not ±90 — full bbox tiling math assumes this range).
const WORLD_BBOX: Bbox = [-180, -85, 180, 85];
// 1,365 tiles total (1+4+16+64+256+1024) — small and one-time. Exported so
// MapCanvas's satellite backdrop layer (see addSatelliteLayer) requests
// exactly this zoom range, not some other one — the whole point is that
// the backdrop's tiles are already sitting in the persistent cache by the
// time anything asks for them.
export const WORLD_OVERVIEW_MAX_ZOOM = 5;

const esriApiKey = import.meta.env.VITE_ESRI_API_KEY as string | undefined;

let triedThisSession = false;

/** Starts (or resumes) the world-overview download if it isn't already
 * complete — safe to call repeatedly (e.g. every time satellite mode is
 * turned on); it no-ops once done. Only triggered lazily, the first time
 * satellite mode is actually used, not on every app launch — someone who
 * never opens satellite mode never pays for this at all. */
export async function ensureWorldOverviewSeeded(): Promise<void> {
  if (!esriApiKey || triedThisSession) return;
  triedThisSession = true;

  const existing = await getRegion(WORLD_OVERVIEW_REGION_ID);
  if (existing) {
    if (existing.status === "downloading" || existing.status === "paused") {
      resumeRegionDownload(existing, esriApiKey);
    }
    return; // "complete" or "error" — leave error rows for the user to retry from the manager, same as any region
  }

  const region: OfflineRegion = {
    id: WORLD_OVERVIEW_REGION_ID,
    name: "World overview (low-res satellite)",
    bbox: WORLD_BBOX,
    minZoom: 0,
    maxZoom: WORLD_OVERVIEW_MAX_ZOOM,
    layers: ["satellite"],
    status: "downloading",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expectedTiles: 0,
    downloadedTiles: 0,
    downloadedBytes: 0,
  };
  await createRegion(region);
  startRegionDownload(region, esriApiKey);
}
