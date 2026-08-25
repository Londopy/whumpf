/**
 * Combines a caller-supplied AbortSignal (used for "stale request, cancel
 * because the input changed") with a fixed timeout (used for "the provider
 * just isn't responding") into one signal a fetch call can use. Without
 * this, a provider that accepts the connection but never responds would
 * leave the UI in a "loading" state indefinitely — the only cancellation
 * any of the network providers had before this was "the user changed
 * what they're asking for", not "this is taking too long".
 *
 * Uses AbortSignal.any/AbortSignal.timeout where available (broadly
 * supported in the Chromium version WebView2/Tauri ships); falls back to a
 * manual composition for older engines rather than assuming.
 */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function") {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

/** Turns a fetch-time AbortError from a timeout into a message that says
 * so, instead of the generic "The operation was aborted" browsers show —
 * distinguishing "the provider is too slow" from "you cancelled this" or
 * "the network dropped" makes the resulting error banner actually useful. */
export function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "Request timed out — the provider took too long to respond.";
    if (!navigator.onLine) return "You appear to be offline.";
    if (err.name === "AbortError") return "Request cancelled.";
    return err.message;
  }
  return String(err);
}
