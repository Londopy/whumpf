// IndexedDB-backed persistent cache for tiles and geocode results.
//
// Previously this went through Tauri IPC to a Rust/SQLite cache. That
// added, per lookup: an IPC serialization round-trip, base64 encode/decode
// (~33% size inflation), and lock contention on a single Mutex<Connection>
// — all paid on every one of the dozens of tile requests a single pan/zoom
// burst can fire. IndexedDB lives in the same process as this code (no IPC
// hop at all), stores raw bytes directly, and — as a bonus — works
// identically in the plain browser preview, not just the real Tauri
// window, since it's a standard Web API rather than a Tauri bridge.
const DB_NAME = "contour-cache";
const DB_VERSION = 2;
const STORE = "entries";
const META_STORE = "meta";
const REGION_STORE = "regions";
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export interface CacheStats {
  entry_count: number;
  total_bytes: number;
  max_bytes: number;
}

interface CacheEntry {
  key: string;
  bytes: ArrayBuffer;
  contentType: string | null;
  size: number;
  lastAccessed: number;
  /** Offline regions that "own" this tile (see src/offline/). A tile with
   * one or more owners is pinned — exempt from LRU eviction and from the
   * general "Clear cache" button — and only goes away via deleteRegion()
   * once its last owner is removed. Absent/empty for ordinary opportunistic
   * cache entries from regular browsing. */
  regionIds?: string[];
}

interface MetaRow {
  k: string;
  v: number;
}

export type RegionStatus = "downloading" | "paused" | "complete" | "error";

/** A user-defined offline region: an area + zoom range + layer selection,
 * plus live download progress/status. One row per region in the `regions`
 * store; the actual tile bytes live in `entries`, tagged via regionIds. */
export interface OfflineRegion {
  id: string;
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  /** Layer ids from src/offline/regionTiles.ts — kept as string[] here to
   * avoid a circular import between the storage layer and the layer list. */
  layers: string[];
  status: RegionStatus;
  createdAt: number;
  updatedAt: number;
  expectedTiles: number;
  downloadedTiles: number;
  downloadedBytes: number;
  errorMessage?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction!;
        const store = db.objectStoreNames.contains(STORE)
          ? tx.objectStore(STORE)
          : db.createObjectStore(STORE, { keyPath: "key" });
        if (!store.indexNames.contains("by_lastAccessed")) {
          store.createIndex("by_lastAccessed", "lastAccessed");
        }
        if (!store.indexNames.contains("by_regionIds")) {
          store.createIndex("by_regionIds", "regionIds", { multiEntry: true });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "k" });
        }
        if (!db.objectStoreNames.contains(REGION_STORE)) {
          db.createObjectStore(REGION_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Cursors an index for a single key, invoking `onEntry` for each match.
 * Shared by every "walk all tiles owned by region X" operation below. */
function walkIndex(store: IDBObjectStore, indexName: string, key: IDBValidKey, onEntry: (cursor: IDBCursorWithValue) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.index(indexName).openCursor(IDBKeyRange.only(key));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      onEntry(cursor);
      cursor.continue();
    };
  });
}

async function getMeta(db: IDBDatabase, key: string, fallback: number): Promise<number> {
  const tx = db.transaction(META_STORE, "readonly");
  const row = (await reqToPromise(tx.objectStore(META_STORE).get(key))) as MetaRow | undefined;
  return row?.v ?? fallback;
}

function isPinned(entry: CacheEntry): boolean {
  return Boolean(entry.regionIds && entry.regionIds.length > 0);
}

/** Finds the least-recently-accessed entry that isn't pinned by an offline
 * region, skipping past pinned ones instead of picking them. */
function findOldestUnpinned(store: IDBObjectStore): Promise<CacheEntry | null> {
  return new Promise((resolve, reject) => {
    const req = store.index("by_lastAccessed").openCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      const entry = cursor.value as CacheEntry;
      if (isPinned(entry)) {
        cursor.continue();
        return;
      }
      resolve(entry);
    };
  });
}

/** Deletes least-recently-accessed, non-region-pinned entries until total
 * size fits within the configured cap. Normally 0-1 deletes per call, since
 * this runs right after the put that might have crossed the line. Pinned
 * (offline-region) tiles are never touched here — if they alone exceed the
 * cap, that's expected (the user explicitly downloaded them); only
 * deleteRegion() removes them. */
async function evictToFit(db: IDBDatabase): Promise<void> {
  const maxBytes = await getMeta(db, "maxBytes", DEFAULT_MAX_BYTES);
  let totalBytes = await getMeta(db, "totalBytes", 0);
  while (totalBytes > maxBytes) {
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    const store = tx.objectStore(STORE);
    const oldest = await findOldestUnpinned(store);
    if (!oldest) {
      await txDone(tx);
      break;
    }
    store.delete(oldest.key);
    totalBytes -= oldest.size;
    tx.objectStore(META_STORE).put({ k: "totalBytes", v: totalBytes } satisfies MetaRow);
    await txDone(tx);
  }
}

/** Reads a cached entry's raw bytes, touching its lastAccessed for LRU
 * purposes. Returns null on a miss, and also null (never throws) if
 * IndexedDB is unavailable for some reason, so callers can treat "no
 * cache" and "cache unavailable" the same way and fall back to network. */
export async function cacheGetBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const entry = (await reqToPromise(store.get(key))) as CacheEntry | undefined;
    if (!entry) {
      await txDone(tx);
      return null;
    }
    store.put({ ...entry, lastAccessed: Date.now() });
    await txDone(tx);
    return { bytes: new Uint8Array(entry.bytes), contentType: entry.contentType };
  } catch {
    return null;
  }
}

/** Checks whether a key is already cached without touching lastAccessed or
 * decoding its bytes — used by the offline download job to cheaply skip
 * tiles it (or a prior run, or plain browsing) already has. */
export async function cacheHas(key: string): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const count = await reqToPromise(tx.objectStore(STORE).count(key));
    await txDone(tx);
    return count > 0;
  } catch {
    return false;
  }
}

/** Tags an already-cached entry as also owned by `regionId`, without
 * re-fetching or re-writing its bytes. Used when a region download
 * encounters a tile that's already present (from a prior partial run or
 * from ordinary browsing) — it should count toward that region and survive
 * that region's lifetime, without a redundant network request. Returns
 * false if the key isn't cached at all (caller should fetch it instead). */
export async function cacheAdoptForRegion(key: string, regionId: string): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const entry = (await reqToPromise(store.get(key))) as CacheEntry | undefined;
    if (!entry) {
      await txDone(tx);
      return false;
    }
    const regionIds = Array.from(new Set([...(entry.regionIds ?? []), regionId]));
    store.put({ ...entry, regionIds, lastAccessed: Date.now() });
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

/** `regionId`, when given, tags the entry as owned by that offline region
 * (pinned — see isPinned/evictToFit) in addition to writing its bytes. */
export async function cachePutBytes(key: string, bytes: Uint8Array, contentType?: string | null, regionId?: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    const store = tx.objectStore(STORE);
    const metaStore = tx.objectStore(META_STORE);

    const existing = (await reqToPromise(store.get(key))) as CacheEntry | undefined;
    const copy = bytes.slice(); // defensive copy — never alias a buffer the caller might reuse
    const size = copy.byteLength;
    const regionIds = regionId ? Array.from(new Set([...(existing?.regionIds ?? []), regionId])) : existing?.regionIds;
    store.put({
      key,
      bytes: copy.buffer,
      contentType: contentType ?? null,
      size,
      lastAccessed: Date.now(),
      regionIds,
    } satisfies CacheEntry);

    const currentTotal = (await reqToPromise(metaStore.get("totalBytes"))) as MetaRow | undefined;
    const delta = size - (existing?.size ?? 0);
    metaStore.put({ k: "totalBytes", v: (currentTotal?.v ?? 0) + delta } satisfies MetaRow);

    await txDone(tx);
    await evictToFit(db);
  } catch {
    // Caching is best-effort — a failure here must never break the tile
    // fetch or search call that triggered it.
  }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const hit = await cacheGetBytes(key);
  if (!hit) return null;
  try {
    return JSON.parse(new TextDecoder().decode(hit.bytes)) as T;
  } catch {
    return null;
  }
}

export async function cachePutJson(key: string, value: unknown): Promise<void> {
  await cachePutBytes(key, new TextEncoder().encode(JSON.stringify(value)), "application/json");
}

export async function cacheStats(): Promise<CacheStats | null> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readonly");
    const count = await reqToPromise(tx.objectStore(STORE).count());
    const totalRow = (await reqToPromise(tx.objectStore(META_STORE).get("totalBytes"))) as MetaRow | undefined;
    const maxRow = (await reqToPromise(tx.objectStore(META_STORE).get("maxBytes"))) as MetaRow | undefined;
    await txDone(tx);
    return { entry_count: count, total_bytes: totalRow?.v ?? 0, max_bytes: maxRow?.v ?? DEFAULT_MAX_BYTES };
  } catch {
    return null;
  }
}

/** Clears the general opportunistic cache only — tiles belonging to a
 * downloaded offline region are pinned and untouched here, same as they're
 * exempt from LRU eviction. Delete a region explicitly (deleteRegion) to
 * free its tiles. */
export async function cacheClear(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE, META_STORE], "readwrite");
  const store = tx.objectStore(STORE);
  let remainingBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const req = store.openCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const entry = cursor.value as CacheEntry;
      if (isPinned(entry)) {
        remainingBytes += entry.size;
      } else {
        store.delete(entry.key);
      }
      cursor.continue();
    };
  });
  tx.objectStore(META_STORE).put({ k: "totalBytes", v: remainingBytes } satisfies MetaRow);
  await txDone(tx);
}

export async function cacheSetMaxBytes(maxBytes: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put({ k: "maxBytes", v: maxBytes } satisfies MetaRow);
  await txDone(tx);
  await evictToFit(db);
}

// ---------------------------------------------------------------------------
// Offline regions

// Region metadata reads/writes degrade to a safe empty/no-op result on any
// IndexedDB failure (corrupted DB, storage quota, private-browsing
// restrictions) rather than throwing — same convention as cacheGetBytes/
// cacheHas/cachePutBytes above. The Offline Regions Manager UI would
// otherwise have no way to recover from an unhandled rejection here; an
// empty list reads as "no regions yet", which is honest enough given the
// alternative is a broken panel.
export async function createRegion(region: OfflineRegion): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(REGION_STORE, "readwrite");
    tx.objectStore(REGION_STORE).put(region);
    await txDone(tx);
  } catch {
    // Best-effort — the download itself already succeeded; losing the
    // region row means it just won't show up in the manager.
  }
}

export async function updateRegion(id: string, patch: Partial<Omit<OfflineRegion, "id">>): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(REGION_STORE, "readwrite");
    const store = tx.objectStore(REGION_STORE);
    const existing = (await reqToPromise(store.get(id))) as OfflineRegion | undefined;
    if (!existing) {
      await txDone(tx);
      return;
    }
    store.put({ ...existing, ...patch, id, updatedAt: Date.now() } satisfies OfflineRegion);
    await txDone(tx);
  } catch {
    // Best-effort, see createRegion.
  }
}

export async function renameRegion(id: string, name: string): Promise<void> {
  await updateRegion(id, { name });
}

export async function getRegion(id: string): Promise<OfflineRegion | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(REGION_STORE, "readonly");
    const row = (await reqToPromise(tx.objectStore(REGION_STORE).get(id))) as OfflineRegion | undefined;
    await txDone(tx);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function listRegions(): Promise<OfflineRegion[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(REGION_STORE, "readonly");
    const rows = (await reqToPromise(tx.objectStore(REGION_STORE).getAll())) as OfflineRegion[];
    await txDone(tx);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Sums the real on-disk size of exactly the tiles this region owns —
 * independent of the region row's own `downloadedBytes` progress counter,
 * which is a running total updated during download rather than re-derived
 * from storage each time. */
export async function regionStorageBytes(id: string): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  let total = 0;
  await walkIndex(tx.objectStore(STORE), "by_regionIds", id, (cursor) => {
    total += (cursor.value as CacheEntry).size;
  });
  await txDone(tx);
  return total;
}

/** Removes `id` from every tile it owns, physically deleting a tile only
 * once no region references it any more (so overlapping regions sharing a
 * tile at low zoom don't lose it out from under each other), then deletes
 * the region row itself. */
export async function deleteRegion(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE, META_STORE, REGION_STORE], "readwrite");
  const store = tx.objectStore(STORE);
  let freedBytes = 0;
  await walkIndex(store, "by_regionIds", id, (cursor) => {
    const entry = cursor.value as CacheEntry;
    const remaining = (entry.regionIds ?? []).filter((r) => r !== id);
    if (remaining.length === 0) {
      freedBytes += entry.size;
      store.delete(entry.key);
    } else {
      store.put({ ...entry, regionIds: remaining });
    }
  });
  if (freedBytes > 0) {
    const metaStore = tx.objectStore(META_STORE);
    const currentTotal = (await reqToPromise(metaStore.get("totalBytes"))) as MetaRow | undefined;
    metaStore.put({ k: "totalBytes", v: Math.max(0, (currentTotal?.v ?? 0) - freedBytes) } satisfies MetaRow);
  }
  tx.objectStore(REGION_STORE).delete(id);
  await txDone(tx);
}
