/** Cesium imagery that reads through the IndexedDB tile cache.
 *
 * This is the Cesium half of what contour-map did with a MapLibre custom
 * protocol (see ../cache/tileCacheProtocol.ts for the engine-agnostic half
 * and why it was split).
 *
 * Cesium resolves tile URLs through `Resource`, so the interception point
 * is a Resource subclass whose `fetchArrayBuffer`/`fetchImage` route through
 * `fetchThroughCache`. That keeps one cache and one concurrency budget
 * shared across every imagery source, exactly as the protocol did.
 */
import { fetchThroughCache } from "../cache/tileCacheProtocol";

export interface ImageryCesiumApi {
  UrlTemplateImageryProvider: new (options: Record<string, unknown>) => unknown;
  ImageryLayer: new (provider: unknown, options?: Record<string, unknown>) => CesiumImageryLayer;
  Resource: new (options: { url: string }) => unknown;
  Credit: new (html: string, showOnScreen?: boolean) => unknown;
}

export interface CesiumImageryLayer {
  alpha: number;
  show: boolean;
}

export interface ImageryViewerLike {
  imageryLayers: {
    add(layer: CesiumImageryLayer, index?: number): void;
    remove(layer: CesiumImageryLayer, destroy?: boolean): boolean;
  };
}

export interface CachedImageryOptions {
  /** XYZ template, e.g. https://host/{z}/{x}/{y}.png */
  urlTemplate: string;
  attributionHtml?: string;
  minimumLevel?: number;
  maximumLevel?: number;
  alpha?: number;
  /** When false, tiles bypass the persistent cache and go straight to the
   * network. Weather overlays set this -- see weatherLayer.ts. */
  cache?: boolean;
}

/** Decodes a fetched tile into something Cesium will accept as an image. */
async function bufferToImage(buffer: ArrayBuffer): Promise<ImageBitmap | HTMLImageElement> {
  const blob = new Blob([buffer]);
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  // Safari fallback: no createImageBitmap for arbitrary blobs in older builds.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Tile decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

/**
 * Builds a Cesium imagery layer whose tiles pass through the shared cache.
 *
 * Cesium calls `requestImage` per tile; overriding it is the documented
 * extension point and is what lets the cache sit underneath without the
 * provider knowing. Errors are swallowed into a rejected promise, which
 * Cesium treats the same way MapLibre treated a failed custom-protocol
 * request: the tile renders blank and the scene keeps going.
 */
export function createCachedImageryLayer(
  cesium: ImageryCesiumApi,
  options: CachedImageryOptions,
): CesiumImageryLayer {
  const provider = new cesium.UrlTemplateImageryProvider({
    url: options.urlTemplate,
    minimumLevel: options.minimumLevel ?? 0,
    maximumLevel: options.maximumLevel ?? 19,
    credit: options.attributionHtml ? new cesium.Credit(options.attributionHtml, false) : undefined,
  }) as {
    requestImage?: (x: number, y: number, level: number, request?: unknown) => unknown;
    _cachedRequestImage?: unknown;
  };

  if (options.cache !== false) {
    const template = options.urlTemplate;
    provider.requestImage = (x: number, y: number, level: number) => {
      const url = template
        .replace("{z}", String(level))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const controller = new AbortController();
      return fetchThroughCache(url, controller.signal).then(bufferToImage);
    };
  }

  const layer = new cesium.ImageryLayer(provider, {});
  if (options.alpha !== undefined) layer.alpha = options.alpha;
  return layer;
}
