/** Info panel for a clicked ski run or lift.
 *
 * Stands in for contour-map's SkiInfoPanel.tsx, rebuilt in whumpf's idiom
 * and markup conventions.
 *
 * One deliberate difference: elevation is only shown when terrain is
 * actually loaded and reports a height. The desktop client's SkiRun type
 * already drew the distinction -- `undefined` for "not queried" versus
 * `null` for "queried and unavailable" -- and this respects it rather than
 * printing a zero. On an avalanche tool, a fabricated elevation is worse
 * than a blank.
 */
import type { SkiLift, SkiRun } from "../providers/SkiDataProvider";
import type { SkiSelection } from "../cesium/skiLayer";
import type { ElevationProvider } from "../providers/ElevationProvider";

function metres(value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} m`;
}

function km(metresValue: number | undefined): string {
  if (metresValue === undefined || !Number.isFinite(metresValue)) return "—";
  return metresValue >= 1000
    ? `${(metresValue / 1000).toFixed(2)} km`
    : `${Math.round(metresValue)} m`;
}

export class FeatureInfoPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly elevation?: ElevationProvider,
  ) {
    this.clear();
  }

  clear(): void {
    this.root.hidden = true;
    this.root.innerHTML = "";
  }

  async show(selection: SkiSelection): Promise<void> {
    this.root.hidden = false;
    this.root.innerHTML =
      selection.kind === "run" ? this.runHtml(selection.run) : this.liftHtml(selection.lift);

    const close = this.root.querySelector<HTMLButtonElement>(".info-close");
    if (close) close.onclick = () => this.clear();

    // Elevation needs the terrain tiles under the feature to be resident, so
    // it is filled in after the panel is already on screen rather than
    // blocking it.
    await this.fillElevation(selection);
  }

  private async fillElevation(selection: SkiSelection): Promise<void> {
    if (!this.elevation) return;
    const geometry =
      selection.kind === "run" ? selection.run.geometry : selection.lift.geometry;
    if (geometry.length < 2) return;

    const [start, end] = [geometry[0]!, geometry[geometry.length - 1]!];
    const [startEl, endEl] = await Promise.all([
      this.elevation.getElevation(start),
      this.elevation.getElevation(end),
    ]);

    const startNode = this.root.querySelector("[data-field=start-elev]");
    const endNode = this.root.querySelector("[data-field=end-elev]");
    const dropNode = this.root.querySelector("[data-field=drop]");
    if (startNode) startNode.textContent = metres(startEl);
    if (endNode) endNode.textContent = metres(endEl);
    if (dropNode) {
      dropNode.textContent =
        startEl !== null && endEl !== null ? metres(Math.abs(startEl - endEl)) : "—";
    }
  }

  private header(title: string, subtitle: string, color?: string): string {
    const swatch = color
      ? `<i class="info-swatch" style="background:${color}"></i>`
      : "";
    return `
      <div class="info-head">
        ${swatch}
        <div>
          <div class="info-title">${escapeHtml(title)}</div>
          <div class="info-sub">${escapeHtml(subtitle)}</div>
        </div>
        <button class="info-close" aria-label="Close">×</button>
      </div>`;
  }

  private runHtml(run: SkiRun): string {
    return `
      ${this.header(run.name ?? "Unnamed run", `Piste · ${run.difficulty}`, run.color)}
      <dl>
        <dt>Length</dt><dd>${km(run.lengthMeters)}</dd>
        <dt>Top</dt><dd data-field="start-elev">…</dd>
        <dt>Bottom</dt><dd data-field="end-elev">…</dd>
        <dt>Vertical</dt><dd data-field="drop">…</dd>
      </dl>
      <p class="info-caveat">Difficulty is as tagged in OpenStreetMap. Untagged
      runs show as “unknown” rather than being guessed.</p>`;
  }

  private liftHtml(lift: SkiLift): string {
    return `
      ${this.header(lift.nameAndType ?? "Lift", `Lift · ${lift.liftType}`, lift.color)}
      <dl>
        <dt>Status</dt><dd>${escapeHtml(lift.status ?? "unknown")}</dd>
        <dt>Base</dt><dd data-field="start-elev">…</dd>
        <dt>Top</dt><dd data-field="end-elev">…</dd>
        <dt>Vertical</dt><dd data-field="drop">…</dd>
      </dl>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
