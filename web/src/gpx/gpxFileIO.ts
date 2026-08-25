/** Browser file I/O, replacing the Tauri native-dialog implementation.
 *
 * Ported from contour-map (kiy-codes). The exported signatures are unchanged
 * so every call site works as written; only the mechanism differs.
 *
 * Two paths, picked at runtime:
 *   - File System Access API (Chromium): a real save/open picker, so the user
 *     chooses the destination and we can report an honest cancelled/saved.
 *   - Anchor download + hidden <input type=file> (Firefox, Safari): the file
 *     goes to the download directory with no picker, and a cancelled save is
 *     indistinguishable from a completed one -- hence the `true` return there.
 *
 * The Tauri original wrote through a custom Rust command because the fs
 * plugin's ACL could not scope "wherever the user just picked". The browser
 * has no such problem: the picker hands back a writable handle directly.
 */

interface FileFilter {
  name: string;
  extensions: string[];
}

const GPX_FILTER: FileFilter = { name: "GPX", extensions: ["gpx"] };
const TRACK_FILTER: FileFilter = {
  name: "GPS tracks",
  extensions: ["gpx", "geojson", "json", "kml"],
};

// The File System Access API is still unshipped in Firefox and Safari.
function hasFilePicker(): boolean {
  return typeof (globalThis as any).showSaveFilePicker === "function";
}

function toAcceptMap(filter: FileFilter): Record<string, string[]> {
  return { "application/octet-stream": filter.extensions.map((e) => `.${e}`) };
}

function acceptAttr(filter: FileFilter): string {
  return filter.extensions.map((e) => `.${e}`).join(",");
}

/** Triggers a plain browser download. No picker, so we cannot detect cancel. */
function downloadBlob(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Prompts for a file and resolves its text, or null if dismissed.
 *
 * Note the dismissal caveat: `input.onchange` never fires on cancel, so we
 * lean on the window regaining focus as the signal that the dialog closed.
 * The timeout gives the change event a chance to land first. */
function pickFileViaInput(filter: FileFilter): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = acceptAttr(filter);
    input.style.display = "none";

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.onchange = () => finish(input.files?.[0] ?? null);
    window.addEventListener("focus", () => setTimeout(() => finish(null), 500), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

async function saveWithFilter(
  content: string,
  defaultFilename: string,
  filter: FileFilter,
): Promise<boolean> {
  if (!hasFilePicker()) {
    downloadBlob(content, defaultFilename);
    return true;
  }
  try {
    const handle = await (globalThis as any).showSaveFilePicker({
      suggestedName: defaultFilename,
      types: [{ description: filter.name, accept: toAcceptMap(filter) }],
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (err) {
    // AbortError is the user dismissing the picker -- not a failure.
    if (err instanceof DOMException && err.name === "AbortError") return false;
    throw err;
  }
}

async function openWithFilter(
  filter: FileFilter,
): Promise<{ name: string; contents: string } | null> {
  if (hasFilePicker() && typeof (globalThis as any).showOpenFilePicker === "function") {
    try {
      const [handle] = await (globalThis as any).showOpenFilePicker({
        multiple: false,
        types: [{ description: filter.name, accept: toAcceptMap(filter) }],
      });
      const file = await handle.getFile();
      return { name: file.name, contents: await file.text() };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
  }
  const file = await pickFileViaInput(filter);
  if (!file) return null;
  return { name: file.name, contents: await file.text() };
}

/** Saves GPX content. Returns false only when the user dismissed a real picker. */
export async function saveGpxFile(content: string, defaultFilename: string): Promise<boolean> {
  return saveWithFilter(content, defaultFilename, GPX_FILTER);
}

/** Reads a user-chosen GPX file as text, or null if dismissed. */
export async function openGpxFile(): Promise<string | null> {
  const picked = await openWithFilter(GPX_FILTER);
  return picked ? picked.contents : null;
}

export interface OpenedTrackFile {
  /** In the Tauri build this was a filesystem path. The browser exposes only
   * the basename, which is all the callers use -- they switch on the
   * extension to pick a parser. */
  path: string;
  contents: string;
}

/** Reads a user-chosen GPX, GeoJSON, or KML file, or null if dismissed. */
export async function openTrackFile(): Promise<OpenedTrackFile | null> {
  const picked = await openWithFilter(TRACK_FILTER);
  return picked ? { path: picked.name, contents: picked.contents } : null;
}

/** Saves arbitrary text under a caller-supplied filter -- used by GeoJSON export. */
export async function saveTextFile(
  content: string,
  defaultFilename: string,
  filter: FileFilter,
): Promise<boolean> {
  return saveWithFilter(content, defaultFilename, filter);
}
