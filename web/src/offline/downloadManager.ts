// Runs an offline region's download: bounded-concurrency tile fetching,
// pause/resume/cancel, progress reporting, and periodic persistence so a
// killed/restarted app can pick back up. Deliberately plain TS (no React) —
// UI subscribes via onProgress().
//
// The core trick that makes resume/restart-recovery "free": every tile is
// checked against the cache before fetching (cacheAdoptForRegion), and the
// full tile list is cheap to re-derive from the region's own bbox/zoom/
// layers. So "resume" and "restart recovery" are both just "run the job
// again" — already-present tiles skip in a single IndexedDB read instead of
// a network round trip, no separate "resume state" format needed.
import type { OfflineRegion, RegionStatus } from "../cache/persistentCache";
import { cacheAdoptForRegion, cachePutBytes, deleteRegion, updateRegion } from "../cache/persistentCache";
import { tileCacheKey } from "../cache/tileCacheProtocol";
import { standardAuxiliaryUrls, tilesForLayer, type OfflineLayerId, type OfflineTileRequest } from "./regionTiles";

const CONCURRENCY = 5;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;
const PROGRESS_PERSIST_EVERY = 25;
const SPEED_WINDOW_MS = 3000;

export interface DownloadProgress {
  regionId: string;
  status: RegionStatus;
  totalTiles: number;
  downloadedTiles: number;
  downloadedBytes: number;
  bytesPerSecond: number;
  currentLayer: OfflineLayerId | null;
  failedTiles: number;
}

export type ProgressListener = (progress: DownloadProgress) => void;

export class RegionDownloadJob {
  private region: OfflineRegion;
  private esriApiKey: string | undefined;
  private listeners = new Set<ProgressListener>();
  private paused = false;
  private cancelled = false;
  private running = false;
  private queue: OfflineTileRequest[] = [];
  private queueIndex = 0;
  private downloadedTiles = 0;
  private downloadedBytes = 0;
  private failedTiles = 0;
  private currentLayer: OfflineLayerId | null = null;
  private speedSamples: { t: number; bytes: number }[] = [];
  private sinceLastPersist = 0;

  constructor(region: OfflineRegion, esriApiKey: string | undefined) {
    this.region = region;
    this.esriApiKey = esriApiKey;
    this.downloadedTiles = region.downloadedTiles;
    this.downloadedBytes = region.downloadedBytes;
  }

  get regionId(): string {
    return this.region.id;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Calls `listener` immediately with the current state, then on every
   * change. Returns an unsubscribe function. */
  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private snapshot(): DownloadProgress {
    return {
      regionId: this.region.id,
      status: this.region.status,
      totalTiles: this.region.expectedTiles,
      downloadedTiles: this.downloadedTiles,
      downloadedBytes: this.downloadedBytes,
      bytesPerSecond: this.currentSpeed(),
      currentLayer: this.currentLayer,
      failedTiles: this.failedTiles,
    };
  }

  private currentSpeed(): number {
    const now = Date.now();
    this.speedSamples = this.speedSamples.filter((s) => now - s.t <= SPEED_WINDOW_MS);
    if (this.speedSamples.length < 2) return 0;
    const first = this.speedSamples[0];
    const last = this.speedSamples[this.speedSamples.length - 1];
    const dtSeconds = (last.t - first.t) / 1000;
    return dtSeconds > 0 ? (last.bytes - first.bytes) / dtSeconds : 0;
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  /** Starts (or, if the previous run only got as far as being paused
   * in-memory, effectively restarts) the download. Re-enumerates the full
   * tile list every time — this is what makes resuming after a pause,
   * crash, or app restart work without a separate saved-queue format. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.cancelled = false;

    await updateRegion(this.region.id, { status: "downloading" });
    this.region = { ...this.region, status: "downloading" };
    this.emit();

    try {
      if (this.region.layers.includes("standard")) {
        this.currentLayer = "standard";
        for (const url of await standardAuxiliaryUrls()) {
          if (this.cancelled) return;
          await this.fetchAndStore({ url, layer: "standard" }, /* countsTowardTotal */ false);
        }
      }
      if (this.cancelled) return;

      const perLayer = await Promise.all(
        this.region.layers.map((layer) =>
          tilesForLayer(layer as OfflineLayerId, this.region.bbox, [this.region.minZoom, this.region.maxZoom], this.esriApiKey),
        ),
      );
      // Lowest zoom first across every layer combined (stable sort keeps
      // each layer's own nearest-to-center ordering within a zoom level).
      this.queue = perLayer.flat().sort((a, b) => a.z - b.z);
      this.queueIndex = 0;

      if (this.region.expectedTiles !== this.queue.length) {
        await updateRegion(this.region.id, { expectedTiles: this.queue.length });
        this.region = { ...this.region, expectedTiles: this.queue.length };
      }
      this.emit();

      await this.runQueue();
      if (this.cancelled) return;

      if (this.paused) {
        await this.persist("paused");
      } else {
        await this.persist(this.failedTiles > 0 ? "error" : "complete", this.failedTiles > 0 ? `${this.failedTiles} tile(s) failed after retries` : undefined);
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private async persist(status: RegionStatus, errorMessage?: string): Promise<void> {
    await updateRegion(this.region.id, {
      status,
      downloadedTiles: this.downloadedTiles,
      downloadedBytes: this.downloadedBytes,
      errorMessage,
    });
    this.region = { ...this.region, status, errorMessage };
  }

  /** Stops pulling new tiles off the queue; in-flight fetches finish
   * naturally. Resumable via start(). */
  pause(): void {
    this.paused = true;
  }

  /** Re-runs the job if it fully stopped (the common case — pause usually
   * wins the race against in-flight tiles finishing before the caller
   * reacts), or simply clears the pause flag if a worker loop is still
   * winding down. */
  resume(): void {
    if (this.running) {
      this.paused = false;
      return;
    }
    void this.start();
  }

  /** Stops the job and deletes the region, freeing any tiles it exclusively
   * owns (shared tiles from an overlapping region survive). */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.paused = false;
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await deleteRegion(this.region.id);
  }

  private async runQueue(): Promise<void> {
    const next = (): OfflineTileRequest | null => {
      if (this.cancelled || this.paused) return null;
      if (this.queueIndex >= this.queue.length) return null;
      return this.queue[this.queueIndex++];
    };
    const workers = Array.from({ length: CONCURRENCY }, () => this.worker(next));
    await Promise.all(workers);
  }

  private async worker(next: () => OfflineTileRequest | null): Promise<void> {
    for (;;) {
      const item = next();
      if (!item) return;
      this.currentLayer = item.layer;
      await this.fetchAndStore(item, true);
      if (this.cancelled) return;
    }
  }

  private async fetchAndStore(item: { url: string; layer: OfflineLayerId }, countsTowardTotal: boolean): Promise<void> {
    const key = tileCacheKey(item.url);

    // Already cached — from a prior run of this job, an interrupted one, or
    // plain browsing. Just claim ownership; no network needed.
    if (await cacheAdoptForRegion(key, this.region.id)) {
      if (countsTowardTotal) this.onTileSettled(0, false);
      return;
    }

    if (!navigator.onLine) {
      if (countsTowardTotal) this.onTileSettled(0, true);
      return;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (this.cancelled) return;
      try {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        await cachePutBytes(key, new Uint8Array(buffer), res.headers.get("content-type"), this.region.id);
        if (countsTowardTotal) this.onTileSettled(buffer.byteLength, false);
        return;
      } catch {
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt));
        }
      }
    }
    if (countsTowardTotal) this.onTileSettled(0, true);
  }

  private onTileSettled(bytes: number, failed: boolean): void {
    if (failed) {
      this.failedTiles++;
    } else {
      this.downloadedTiles++;
      this.downloadedBytes += bytes;
    }
    this.speedSamples.push({ t: Date.now(), bytes: this.downloadedBytes });

    this.sinceLastPersist++;
    if (this.sinceLastPersist >= PROGRESS_PERSIST_EVERY) {
      this.sinceLastPersist = 0;
      void updateRegion(this.region.id, { downloadedTiles: this.downloadedTiles, downloadedBytes: this.downloadedBytes });
    }
    this.emit();
  }
}

// ---------------------------------------------------------------------------
// Module-level job registry — one active job per region, and a way for any
// UI that (re)mounts to reattach to a job already in flight rather than
// accidentally starting a duplicate.

const activeJobs = new Map<string, RegionDownloadJob>();

export function getActiveJob(regionId: string): RegionDownloadJob | undefined {
  return activeJobs.get(regionId);
}

export function startRegionDownload(region: OfflineRegion, esriApiKey?: string): RegionDownloadJob {
  const existing = activeJobs.get(region.id);
  if (existing) return existing;
  const job = new RegionDownloadJob(region, esriApiKey);
  activeJobs.set(region.id, job);
  void job.start();
  return job;
}

export function pauseRegionDownload(regionId: string): void {
  activeJobs.get(regionId)?.pause();
}

export function resumeRegionDownload(region: OfflineRegion, esriApiKey?: string): RegionDownloadJob {
  const existing = activeJobs.get(region.id);
  if (existing) {
    existing.resume();
    return existing;
  }
  return startRegionDownload(region, esriApiKey);
}

export async function cancelRegionDownload(regionId: string): Promise<void> {
  const job = activeJobs.get(regionId);
  if (job) {
    await job.cancel();
    activeJobs.delete(regionId);
  } else {
    // No in-memory job (e.g. the app restarted and it was never resumed) —
    // still need to free whatever tiles it owns.
    await deleteRegion(regionId);
  }
}
