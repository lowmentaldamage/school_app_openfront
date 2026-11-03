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

const MIN_PX = 11;
const MAX_PX = 56;
/** Font sizes are rounded to this step so cached label images are reused. */
const SIZE_STEP = 2;
const CACHE_LIMIT = 1500;
/** Overlap grid cell (CSS px) for decluttering. */
const CELL = 24;

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Size in CSS px. */
  w: number;
  h: number;
}

/**
 * Pure declutter test: a coarse occupancy grid. Labels are offered biggest
 * first; one that lands on cells already taken by a bigger label is
 * dropped, so the map never shows a pile of overlapping names.
 */
export class LabelGrid {
  private readonly taken = new Set<number>();
  constructor(private readonly cols: number) {}

  tryPlace(x0: number, y0: number, x1: number, y1: number): boolean {
    const c0 = Math.floor(x0 / CELL);
    const c1 = Math.floor(x1 / CELL);
    const r0 = Math.floor(y0 / CELL);
    const r1 = Math.floor(y1 / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.taken.has(r * this.cols + c)) return false;
      }
    }
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) this.taken.add(r * this.cols + c);
    }
    return true;
  }
}

export class LabelOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private entries: readonly LabelEntry[] = [];
  private texts = new Map<string, LabelText>();
  private dirty = true;
  private lastKey = "";
  private dpr = 1;
  private readonly sprites = new Map<string, Sprite>();

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
   * One line of text rendered once into a small canvas, then reused. Names
   * and troop counts are separate sprites: names never change, and troop
   * strings ("3.4K") repeat across players and ticks, so both cache well.
   */
  private sprite(
    str: string,
    px: number,
    weight: 600 | 700,
    fill: string,
  ): Sprite {
    const key = `${px}|${weight}|${fill}|${str}`;
    const hit = this.sprites.get(key);
    if (hit !== undefined) {
      // LRU: move to the end.
      this.sprites.delete(key);
      this.sprites.set(key, hit);
      return hit;
    }
    const dpr = this.dpr;
    const font = `${weight} ${px}px Overpass, system-ui, sans-serif`;
    const m = this.ctx;
    m.font = font;
    const pad = Math.ceil(px * 0.2) + 2;
    const w = Math.ceil(m.measureText(str).width) + pad * 2;
    const h = Math.ceil(px * 1.2) + pad * 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.fillStyle = fill;
    ctx.font = font;
    ctx.lineWidth = Math.max(2, px * 0.18);
    ctx.strokeText(str, w / 2, h / 2);
    ctx.fillText(str, w / 2, h / 2);
    const sprite = { canvas, w, h };
    this.sprites.set(key, sprite);
    if (this.sprites.size > CACHE_LIMIT) {
      const oldest = this.sprites.keys().next().value;
      if (oldest !== undefined) this.sprites.delete(oldest);
    }
    return sprite;
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
      if (this.dpr !== dpr) this.sprites.clear();
      this.dpr = dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Project and size every on-screen label, then draw biggest first.
    const visible: { x: number; y: number; font: number; text: LabelText }[] =
      [];
    for (const e of this.entries) {
      if (e.size <= 0) continue;
      const text = this.texts.get(e.playerID);
      if (text === undefined) continue;
      const p = project(e.x, e.y);
      if (p.x < -200 || p.y < -100 || p.x > cssW + 200 || p.y > cssH + 100)
        continue;
      const q = project(e.x + e.size, e.y);
      const px = Math.hypot(q.x - p.x, q.y - p.y);
      if (px < MIN_PX && !text.mine) continue;
      const font =
        Math.round(Math.min(MAX_PX, Math.max(MIN_PX, px)) / SIZE_STEP) *
        SIZE_STEP;
      visible.push({ x: p.x, y: p.y, font, text });
    }
    visible.sort((a, b) =>
      a.text.mine !== b.text.mine ? (a.text.mine ? -1 : 1) : b.font - a.font,
    );
    const grid = new LabelGrid(Math.ceil(cssW / CELL) + 20);
    for (const v of visible) {
      const fill = v.text.mine ? "#ffe680" : "#ffffff";
      const name = this.sprite(v.text.name, v.font, 700, fill);
      const small = Math.max(MIN_PX - 2, Math.round(v.font * 0.72));
      const troops = this.sprite(v.text.troops, small, 600, fill);
      const w = Math.max(name.w, troops.w);
      const h = name.h + troops.h - Math.round(v.font * 0.45);
      const x0 = v.x - w / 2;
      const y0 = v.y - h / 2;
      // Shrink the box a little: touching labels are fine, piles are not.
      const inset = Math.min(w, h) * 0.2;
      if (
        !grid.tryPlace(
          x0 + inset + 200,
          y0 + inset + 100,
          x0 + w - inset + 200,
          y0 + h - inset + 100,
        )
      ) {
        continue;
      }
      ctx.drawImage(name.canvas, v.x - name.w / 2, y0, name.w, name.h);
      ctx.drawImage(
        troops.canvas,
        v.x - troops.w / 2,
        y0 + h - troops.h,
        troops.w,
        troops.h,
      );
    }
  }

  dispose(): void {
    this.sprites.clear();
    this.canvas.remove();
  }
}
