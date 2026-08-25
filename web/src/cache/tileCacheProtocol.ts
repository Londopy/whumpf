/** Cached tile fetching, ported from contour-map (kiy-codes).
 *
 * The original registered a MapLibre custom protocol (`maplibregl.addProtocol`).
 * Cesium has no equivalent hook, so this splits into two pieces:
 *
 *   - `fetchThroughCache` -- the engine-agnostic half. Cache lookup, offline
 *     fast-fail, and the concurrency semaphore, all preserved verbatim from
 *     his implementation because that logic was hard-won and is not specific
 *     to any map engine.
 *   - `CachedImageryProvider` (see ../cesium/cachedImagery.ts) -- the Cesium
 *     half, which routes imagery tile requests through the above.
 *
 * The URL-rewriting helpers (`withCacheScheme`, `CACHE_SCHEME`) are kept so
 * the offline downloader's URL bookkeeping stays byte-identical to his.
 */
import { cacheGetBytes, cachePutBytes } from "./persistentCache";

export const CACHE_SCHEME = "wmcache";

// Bounds how many cache-miss network fetches run at once across every tile
// source sharing this path (base map, DEM, satellite, topo, ski, waymarked
// trails). Cesium's RequestScheduler does throttle its own requests, but
// this path deliberately bypasses it -- we issue plain fetch() calls so we
// can intercept the bytes for caching -- so the cap still has to live here.
// 6 matches the classic per-origin HTTP/1.1 browser limit: high enough that
// normal panning stays smooth (cache hits below don't queue at all), low
// enough to behave as a good citizen of free tile providers with modest
// published limits. Queued requests are dropped without ever fetching if
// they're aborted first (panned away before their turn) -- no point spending
// a network request or a queue slot on a tile that's no longer needed.
const MAX_CONCURRENT_FETCHES = 6;
let activeFetches = 0;
const waitQueue: (() => void)[] = [];

function acquireFetchSlot(signal: AbortSignal): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const idx = waitQueue.indexOf(grant);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const grant = () => {
      signal.removeEventListener("abort", onAbort);
      activeFetches++;
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    waitQueue.push(grant);
  });
}

function releaseFetchSlot(): void {
  activeFetches--;
  const next = waitQueue.shift();
  if (next) next();
}

/** Fetches a URL through the IndexedDB tile cache, keyed by the real URL.
 *
 * Returns cached bytes when present; otherwise fetches (under the
 * concurrency cap) and populates the cache as a side effect. Throws when
 * offline and uncached, so the caller can render a blank tile and move on. */
export async function fetchThroughCache(
  realUrl: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const key = tileCacheKey(realUrl);

  const cached = await cacheGetBytes(key);
  if (cached) return cached.bytes.buffer as ArrayBuffer;

  if (!navigator.onLine) {
    // No point waiting on a connection that isn't there -- fail fast instead
    // of letting the browser hang on DNS/connect until its own timeout.
    throw new Error(`Offline and not cached: ${realUrl}`);
  }

  await acquireFetchSlot(signal);
  try {
    const response = await fetch(realUrl, { signal });
    if (!response.ok) {
      throw new Error(`Tile fetch failed: ${response.status} ${realUrl}`);
    }
    const buffer = await response.arrayBuffer();
    void cachePutBytes(key, new Uint8Array(buffer), response.headers.get("content-type"));
    return buffer;
  } finally {
    releaseFetchSlot();
  }
}

/** Convenience wrapper for JSON resources (style docs, TileJSON, GeoJSON
 * overlays) that should share the same cache and concurrency budget. */
export async function fetchJsonThroughCache<T = unknown>(
  realUrl: string,
  signal: AbortSignal,
): Promise<T> {
  const buffer = await fetchThroughCache(realUrl, signal);
  return JSON.parse(new TextDecoder().decode(buffer)) as T;
}

/** Rewrites a real tile URL template to route through the cache.
 *
 * Retained from the MapLibre implementation: Cesium never sees this scheme,
 * but the offline downloader records URLs in this form, so keeping it means
 * regions downloaded by either build remain mutually readable. */
export function withCacheScheme(url: string): string {
  return `${CACHE_SCHEME}://${url}`;
}

/** Strips the cache scheme back off, if present. */
export function withoutCacheScheme(url: string): string {
  const prefix = `${CACHE_SCHEME}://`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}

/** The cache key a given real URL is stored/looked-up under.
 *
 * Exported so anything pre-populating or checking the cache for a specific
 * URL (the offline region downloader) stays in sync rather than duplicating
 * the "tile:" prefix as a magic string. */
export function tileCacheKey(url: string): string {
  return `tile:${url}`;
}

/** No-op retained for call-site compatibility with the MapLibre build, where
 * this registered the custom protocol. Cesium wires caching per-provider at
 * construction instead (see ../cesium/cachedImagery.ts), so there is no
 * global registration step. */
export function registerTileCacheProtocol(): void {
  /* intentionally empty */
}
