/** Layer toggles, grafted into whumpf's existing panel.
 *
 * Deliberately not a port of contour-map's LayersMenu/LayersSheet. Those
 * assume his app shell -- a full-screen map with floating glass controls and
 * no concept of an AOI. whumpf already has a panel, a mode switcher, and an
 * AOI selector. Dropping his shell in beside them would give you two
 * competing UIs in one page.
 *
 * So this is the same *capability* expressed in the host's idiom: a small
 * always-visible section using whumpf's existing `.field` / `.pane` classes,
 * driving the ported layer controllers.
 */
import type { LayerController, LayerState, Unsubscribe } from "../cesium/layerController";

export interface ToggleSpec {
  id: string;
  label: string;
  /** Controller to enable/disable. Omit for a toggle wired by `onChange`
   * alone (the graticule, which is not a LayerController). */
  controller?: LayerController;
  onChange?: (on: boolean) => void;
  initial?: boolean;
  /** Shown under the label -- source, licensing, that sort of thing. */
  note?: string;
}

export class LayersPanel {
  private unsubscribes: Unsubscribe[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly toggles: ToggleSpec[],
  ) {
    this.render();
  }

  private render(): void {
    this.root.innerHTML = `<h2>Layers</h2>`;

    for (const spec of this.toggles) {
      const field = document.createElement("div");
      field.className = "field layer-row";

      const label = document.createElement("label");
      label.className = "layer-toggle";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = `layer-${spec.id}`;
      input.checked = spec.initial ?? false;

      const text = document.createElement("span");
      text.textContent = spec.label;

      const status = document.createElement("output");
      status.className = "layer-status";
      status.id = `layer-status-${spec.id}`;

      label.append(input, text, status);
      field.append(label);

      if (spec.note) {
        const note = document.createElement("small");
        note.className = "layer-note";
        note.textContent = spec.note;
        field.append(note);
      }

      input.addEventListener("change", () => {
        const on = input.checked;
        spec.onChange?.(on);
        // Errors surface in the status line rather than as a thrown
        // rejection -- a failed optional overlay must not take the app down.
        void spec.controller?.setEnabled(on).catch((err) => {
          status.textContent = "failed";
          status.className = "layer-status error";
          console.error(`[layer:${spec.id}]`, err);
        });
      });

      if (spec.controller) {
        this.unsubscribes.push(
          spec.controller.state.subscribe((s) => this.renderStatus(status, s)),
        );
      }

      this.root.append(field);
    }
  }

  private renderStatus(el: HTMLOutputElement, state: LayerState): void {
    el.className = "layer-status";
    switch (state.status) {
      case "loading":
        el.textContent = "loading…";
        break;
      case "ready":
        el.textContent = state.count > 0 ? `${state.count}` : "none here";
        break;
      case "error":
        el.textContent = "failed";
        el.className = "layer-status error";
        el.title = state.error ?? "";
        break;
      default:
        el.textContent = "";
    }
  }

  destroy(): void {
    for (const un of this.unsubscribes) un();
    this.unsubscribes = [];
    this.root.innerHTML = "";
  }
}
