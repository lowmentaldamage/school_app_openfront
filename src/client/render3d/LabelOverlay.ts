/**
 * LabelOverlay — player names and troop counts over the 3D map.
 *
 * A single 2D canvas above the WebGL canvas (and below the HUD), redrawn
 * only when the camera moves or a tick lands. Each label is projected
 * through the 3D camera; its font size comes from the simulation's
 * name-box size (in tiles) projected to pixels, so names shrink and grow
 * with the territory exactly like the 2D game. Labels that would be too
 * small to read are skipped.
 */

export interface LabelEntry {
  playerID: string;
  x: number;
  y: number;
  /** Font size in tiles (simulation name-box). */
  size: number;
}

export interface LabelText {
  name: string;
  troops: string;
  mine: boolean;
}

export type Projector = (x: number, y: number) => { x: number; y: number };

const MIN_PX = 9;
const MAX_PX = 56;

export class LabelOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private entries: readonly LabelEntry[] = [];
  private texts = new Map<string, LabelText>();
  private dirty = true;
  private lastKey = "";
  private dpr = 1;

  constructor(after: Element) {
    const c = document.createElement("canvas");
    c.id = "world3d-labels";
    Object.assign(c.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });
    after.insertAdjacentElement("afterend", c);
    this.canvas = c;
    const ctx = c.getContext("2d");
    if (ctx === null) throw new Error("LabelOverlay: no 2D context");
    this.ctx = ctx;
  }

  /** Per tick. */
  setLabels(
    entries: readonly LabelEntry[],
    texts: Map<string, LabelText>,
  ): void {
    this.entries = entries;
    this.texts = texts;
    this.dirty = true;
  }

  /**
   * Per frame. `cameraKey` changes whenever the view changes; when neither
   * it nor the labels changed, nothing is redrawn.
   */
  draw(
    project: Projector,
    cssW: number,
    cssH: number,
    cameraKey: string,
    dprCap: number,
  ): void {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, dprCap);
    if (!this.dirty && cameraKey === this.lastKey && dpr === this.dpr) return;
    this.dirty = false;
    this.lastKey = cameraKey;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (
      this.canvas.width !== w ||
      this.canvas.height !== h ||
      this.dpr !== dpr
    ) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dpr = dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    for (const e of this.entries) {
      if (e.size <= 0) continue;
      const text = this.texts.get(e.playerID);
      if (text === undefined) continue;
      const p = project(e.x, e.y);
      if (p.x < -200 || p.y < -100 || p.x > cssW + 200 || p.y > cssH + 100)
        continue;
      const q = project(e.x + e.size, e.y);
      const px = Math.hypot(q.x - p.x, q.y - p.y);
      if (px < MIN_PX) continue;
      const font = Math.min(MAX_PX, px);
      ctx.font = `700 ${font.toFixed(1)}px Overpass, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, font * 0.18);
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.fillStyle = text.mine ? "#ffe680" : "#ffffff";
      ctx.strokeText(text.name, p.x, p.y - font * 0.35);
      ctx.fillText(text.name, p.x, p.y - font * 0.35);
      const small = font * 0.72;
      ctx.font = `600 ${small.toFixed(1)}px Overpass, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, small * 0.18);
      ctx.strokeText(text.troops, p.x, p.y + font * 0.5);
      ctx.fillText(text.troops, p.x, p.y + font * 0.5);
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
