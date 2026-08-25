/** Shared scaffolding for the ported map layers.
 *
 * contour-map expressed each map layer as a React hook: `useState` for
 * status, `useEffect` for attach/detach, and the returned object as the
 * component's read model. whumpf's web client has no framework, so each of
 * those hooks becomes a small controller class with the same lifecycle --
 * `enable()` / `disable()` stand in for the effect body and its cleanup, and
 * a minimal observable stands in for `useState`.
 *
 * Keeping the shape this close to the original is deliberate: it makes the
 * two implementations diffable when one of them turns out to be wrong.
 */

export type Unsubscribe = () => void;

/** The `useState` replacement: a value plus change notification.
 *
 * Listeners fire only on actual change (`Object.is`), matching React's
 * bail-out behaviour, so a layer that re-reports the same status does not
 * churn the UI. */
export class Observable<T> {
  private listeners = new Set<(value: T) => void>();

  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(next: T): void {
    if (Object.is(this.current, next)) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  /** Subscribes and immediately delivers the current value, so callers do
   * not need a separate initial read to render correctly. */
  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
}

export type LayerStatus = "idle" | "loading" | "ready" | "error";

/** State every ported layer reports, mirroring what the hooks returned. */
export interface LayerState {
  status: LayerStatus;
  error: string | null;
  /** Whatever the layer counts -- regions, runs, trails. */
  count: number;
  fetchedAt: number | null;
}

const INITIAL: LayerState = { status: "idle", error: null, count: 0, fetchedAt: null };

/**
 * Base class for a toggleable map layer.
 *
 * Subclasses implement `attach` (build entities, fetch data, wire events)
 * and `detach` (undo all of it). The base guarantees the two never
 * interleave and that an in-flight `attach` is aborted when the layer is
 * disabled mid-load -- the case the hook handled with an AbortController
 * captured in the effect closure.
 */
export abstract class LayerController {
  readonly state = new Observable<LayerState>(INITIAL);

  protected controller: AbortController | null = null;
  private enabled = false;

  protected abstract attach(signal: AbortSignal): Promise<void>;
  protected abstract detach(): void;

  get isEnabled(): boolean {
    return this.enabled;
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      await this.attach(signal);
    } catch (err) {
      if (signal.aborted) return;
      this.setState({ status: "error", error: describeError(err) });
    }
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.controller?.abort();
    this.controller = null;
    this.detach();
    this.state.set(INITIAL);
  }

  /** Re-runs the load, bypassing any layer-level cache. The hooks did this
   * by bumping a `nonce` in their dependency array. */
  async refresh(): Promise<void> {
    if (!this.enabled) return;
    this.disable();
    await this.enable();
  }

  async setEnabled(on: boolean): Promise<void> {
    if (on) await this.enable();
    else this.disable();
  }

  protected setState(patch: Partial<LayerState>): void {
    this.state.set({ ...this.state.value, ...patch });
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
