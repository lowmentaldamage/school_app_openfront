/**
 * The map editor's document: the editable terrain grid, the nations placed
 * on it, brushes, undo/redo and the random island generator. No DOM and no
 * WebGL, so it is unit tested directly (tests/client/MapEditorCore.test.ts).
 */

import {
  blankMap,
  buildMap,
  decodeMap,
  type EditableMap,
  TERRAIN_IMPASSABLE,
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";

export type BrushTool =
  | "water"
  | "plains"
  | "highland"
  | "mountain"
  | "raise"
  | "lower";

export const BRUSH_TOOLS: readonly BrushTool[] = [
  "water",
  "plains",
  "highland",
  "mountain",
  "raise",
  "lower",
];

/** Elevation bands, as in the map generator (land magnitude 0-30). */
const BAND: Record<"plains" | "highland" | "mountain", [number, number]> = {
  plains: [1, 8],
  highland: [11, 18],
  mountain: [21, 30],
};

export interface EditorNation {
  name: string;
  flag: string;
  x: number;
  y: number;
}

interface Change {
  idx: Int32Array;
  oldKind: Uint8Array;
  oldElev: Uint8Array;
  newKind: Uint8Array;
  newElev: Uint8Array;
  oldNations: EditorNation[];
  newNations: EditorNation[];
}

export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cheap deterministic hash noise in [0, 1). */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1). */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface IslandOptions {
  width: number;
  height: number;
  seed: number;
  /** Share of the map that is land, roughly (0.1-0.8). */
  land?: number;
  /** Number of islands / continents (1-8). */
  islands?: number;
}

/** A random archipelago: fractal noise shaped by a few island centres. */
export function randomIslands(opts: IslandOptions): EditableMap {
  const m = blankMap(opts.width, opts.height);
  const { width: w, height: h } = m;
  const seed = opts.seed | 0;
  const count = Math.max(1, Math.min(8, opts.islands ?? 3));
  const target = Math.max(0.1, Math.min(0.8, opts.land ?? 0.4));
  const centres: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    centres.push({
      x: 0.2 + 0.6 * hash2(i, 1, seed),
      y: 0.2 + 0.6 * hash2(i, 2, seed),
      r: 0.25 + 0.25 * hash2(i, 3, seed),
    });
  }
  const scale = 6 / Math.max(w, h);
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      let shape = 0;
      for (const c of centres) {
        const d = Math.hypot((u - c.x) * (w / Math.max(w, h)), v - c.y) / c.r;
        shape = Math.max(shape, 1 - d);
      }
      // Fade out towards the borders so islands rarely touch the edge.
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const border = edge < 0.08 ? (0.08 - edge) * 8 : 0;
      field[y * w + x] =
        shape * 0.9 + (fbm(x * scale, y * scale, seed) - 0.5) * 0.9 - border;
    }
  }
  // Threshold so about `target` of the map is land.
  const sorted = Float32Array.from(field).sort();
  const cut = sorted[Math.floor((1 - target) * (sorted.length - 1))];
  const top = sorted[sorted.length - 1];
  for (let i = 0; i < w * h; i++) {
    if (field[i] <= cut) continue;
    m.kind[i] = TERRAIN_LAND;
    const t = (field[i] - cut) / Math.max(1e-6, top - cut);
    // Mostly plains, highlands inland, mountain ranges in the middle.
    const ridge = fbm((i % w) * scale * 3, Math.floor(i / w) * scale * 3, seed);
    m.elevation[i] = Math.min(30, Math.round(t * t * 34 + ridge * 6));
  }
  return m;
}

export class MapDocument {
  map: EditableMap;
  nations: EditorNation[] = [];
  name = "";
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private stroke: Map<number, [number, number]> | null = null;
  private strokeNations: EditorNation[] | null = null;
  private dirty: DirtyRect | null = null;
  /** Bumped on every change, for the 3D preview to notice. */
  version = 0;

  constructor(map: EditableMap) {
    this.map = map;
    this.markAll();
  }

  static blank(width: number, height: number): MapDocument {
    return new MapDocument(blankMap(width, height));
  }

  static fromPacked(
    packed: Uint8Array,
    width: number,
    height: number,
  ): MapDocument {
    return new MapDocument(decodeMap(packed, width, height));
  }

  get width(): number {
    return this.map.width;
  }

  get height(): number {
    return this.map.height;
  }

  /** Replace the whole map (new / open / random); clears undo. */
  replace(map: EditableMap, nations: EditorNation[] = []): void {
    this.map = map;
    this.nations = nations;
    this.undoStack = [];
    this.redoStack = [];
    this.markAll();
    this.version++;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  beginStroke(): void {
    this.stroke = new Map();
    this.strokeNations = this.nations.map((n) => ({ ...n }));
  }

  endStroke(): void {
    const stroke = this.stroke;
    const before = this.strokeNations;
    this.stroke = null;
    this.strokeNations = null;
    if (stroke === null || before === null) return;
    const nationsChanged =
      JSON.stringify(before) !== JSON.stringify(this.nations);
    if (stroke.size === 0 && !nationsChanged) return;
    const n = stroke.size;
    const c: Change = {
      idx: new Int32Array(n),
      oldKind: new Uint8Array(n),
      oldElev: new Uint8Array(n),
      newKind: new Uint8Array(n),
      newElev: new Uint8Array(n),
      oldNations: before,
      newNations: this.nations.map((x) => ({ ...x })),
    };
    let i = 0;
    for (const [idx, [k, e]] of stroke) {
      c.idx[i] = idx;
      c.oldKind[i] = k;
      c.oldElev[i] = e;
      c.newKind[i] = this.map.kind[idx];
      c.newElev[i] = this.map.elevation[idx];
      i++;
    }
    this.undoStack.push(c);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    const c = this.undoStack.pop();
    if (!c) return false;
    this.apply(c.idx, c.oldKind, c.oldElev);
    this.nations = c.oldNations.map((n) => ({ ...n }));
    this.redoStack.push(c);
    this.version++;
    return true;
  }

  redo(): boolean {
    const c = this.redoStack.pop();
    if (!c) return false;
    this.apply(c.idx, c.newKind, c.newElev);
    this.nations = c.newNations.map((n) => ({ ...n }));
    this.undoStack.push(c);
    this.version++;
    return true;
  }

  private apply(idx: Int32Array, kind: Uint8Array, elev: Uint8Array): void {
    const w = this.map.width;
    for (let i = 0; i < idx.length; i++) {
      this.map.kind[idx[i]] = kind[i];
      this.map.elevation[idx[i]] = elev[i];
      this.markTile(idx[i] % w, Math.floor(idx[i] / w));
    }
  }

  private set(i: number, kind: number, elev: number): void {
    const m = this.map;
    if (m.kind[i] === kind && m.elevation[i] === elev) return;
    if (this.stroke && !this.stroke.has(i)) {
      this.stroke.set(i, [m.kind[i], m.elevation[i]]);
    }
    m.kind[i] = kind;
    m.elevation[i] = elev;
  }

  /** Paint one brush dab, a disc of `radius` tiles centred on (cx, cy). */
  paint(cx: number, cy: number, radius: number, tool: BrushTool): void {
    const m = this.map;
    const r = Math.max(0.5, radius);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(m.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(m.height - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r2) continue;
        const i = y * m.width + x;
        // Soft falloff for raise/lower: strongest at the centre.
        const falloff = 1 - Math.sqrt(d2) / (r + 0.5);
        switch (tool) {
          case "water":
            this.set(i, TERRAIN_WATER, 0);
            break;
          case "plains":
          case "highland":
          case "mountain": {
            const [lo, hi] = BAND[tool];
            // Mountains peak in the middle of the brush.
            const t =
              tool === "mountain"
                ? Math.max(falloff, hash2(x, y, 5) * 0.4)
                : hash2(x, y, 9);
            this.set(i, TERRAIN_LAND, Math.round(lo + (hi - lo) * t));
            break;
          }
          case "raise":
          case "lower": {
            if (m.kind[i] === TERRAIN_WATER) {
              if (tool === "raise") this.set(i, TERRAIN_LAND, 1);
              break;
            }
            if (m.kind[i] === TERRAIN_IMPASSABLE) break;
            const step = Math.max(1, Math.round(3 * falloff));
            const e = m.elevation[i] + (tool === "raise" ? step : -step);
            if (e < 0) this.set(i, TERRAIN_WATER, 0);
            else this.set(i, TERRAIN_LAND, Math.min(30, e));
            break;
          }
        }
      }
    }
    this.mark(x0, y0, x1, y1);
    // Nations on tiles that became water are removed.
    if (tool === "water" || tool === "lower") {
      this.nations = this.nations.filter(
        (n) => m.kind[n.y * m.width + n.x] === TERRAIN_LAND,
      );
    }
    this.version++;
  }

  /** Paint dabs along a line, spaced so the stroke has no gaps. */
  paintLine(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    radius: number,
    tool: BrushTool,
  ): void {
    const dist = Math.hypot(bx - ax, by - ay);
    const step = Math.max(0.5, radius * 0.5);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.paint(ax + (bx - ax) * t, ay + (by - ay) * t, radius, tool);
    }
  }

  isLand(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.map.kind[y * this.width + x] === TERRAIN_LAND;
  }

  /** Adds a nation on a land tile; returns false on water. */
  addNation(x: number, y: number, name: string, flag: string): boolean {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.isLand(x, y)) return false;
    this.nations.push({ name, flag, x, y });
    this.version++;
    return true;
  }

  /** Replace all land heights in one undoable step. */
  setElevation(next: Uint8Array): void {
    this.beginStroke();
    for (let i = 0; i < next.length; i++) {
      if (
        this.map.kind[i] === TERRAIN_LAND &&
        next[i] !== this.map.elevation[i]
      ) {
        this.set(i, TERRAIN_LAND, next[i]);
      }
    }
    this.endStroke();
    this.markAll();
    this.version++;
  }

  /** Add nations in one undoable step (replacing them when `replace`). */
  addNations(list: EditorNation[], replace: boolean): void {
    this.beginStroke();
    this.nations = replace ? [...list] : [...this.nations, ...list];
    this.endStroke();
    this.version++;
  }

  /** Index of the nation nearest (x, y) within `within` tiles, or -1. */
  nationAt(x: number, y: number, within: number): number {
    let best = -1;
    let bestD = within * within;
    this.nations.forEach((n, i) => {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  removeNation(i: number): void {
    if (i < 0 || i >= this.nations.length) return;
    this.nations.splice(i, 1);
    this.version++;
  }

  moveNation(i: number, x: number, y: number): boolean {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.isLand(x, y) || !this.nations[i]) return false;
    this.nations[i].x = x;
    this.nations[i].y = y;
    this.version++;
    return true;
  }

  renameNation(i: number, name: string, flag: string): void {
    if (!this.nations[i]) return;
    this.nations[i].name = name;
    this.nations[i].flag = flag;
    this.version++;
  }

  /** Packed map.bin of the current grid (for the 3D preview and saving). */
  packed(): Uint8Array {
    return buildMap(this.map).map;
  }

  landTiles(): number {
    let n = 0;
    for (let i = 0; i < this.map.kind.length; i++) {
      if (this.map.kind[i] === TERRAIN_LAND) n++;
    }
    return n;
  }

  /** The area changed since the last call (for redrawing the 2D view). */
  takeDirty(): DirtyRect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  private markAll(): void {
    this.dirty = {
      x0: 0,
      y0: 0,
      x1: this.map.width - 1,
      y1: this.map.height - 1,
    };
  }

  private markTile(x: number, y: number): void {
    this.mark(x, y, x, y);
  }

  private mark(x0: number, y0: number, x1: number, y1: number): void {
    const d = this.dirty;
    if (d === null) this.dirty = { x0, y0, x1, y1 };
    else {
      d.x0 = Math.min(d.x0, x0);
      d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1);
      d.y1 = Math.max(d.y1, y1);
    }
  }
}

/** Top-down colour of a tile for the 2D editing view (RGB 0-255). */
export function tileColor(
  kind: number,
  elevation: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  if (kind === TERRAIN_WATER) {
    out[0] = 38;
    out[1] = 84;
    out[2] = 140;
  } else if (kind === TERRAIN_IMPASSABLE) {
    out[0] = 230;
    out[1] = 232;
    out[2] = 236;
  } else if (elevation < 10) {
    const t = elevation / 9;
    out[0] = Math.round(120 + 40 * t);
    out[1] = Math.round(168 + 12 * t);
    out[2] = Math.round(92 + 10 * t);
  } else if (elevation < 20) {
    const t = (elevation - 10) / 9;
    out[0] = Math.round(176 + 30 * t);
    out[1] = Math.round(170 - 20 * t);
    out[2] = Math.round(108 - 10 * t);
  } else {
    const t = (elevation - 20) / 10;
    out[0] = Math.round(140 + 90 * t);
    out[1] = Math.round(120 + 105 * t);
    out[2] = Math.round(104 + 125 * t);
  }
  return out;
}

// ------------------------------------------------------------ image import

export type ImageMode = "auto" | "picture" | "heightmap" | "game";

export interface ImageImportOptions {
  mode?: ImageMode;
  /** Heightmap only: grey level (0-255) below which is sea. */
  seaLevel?: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major (ImageData.data). */
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Map size for an image: longest side `maxSide` (small pictures are
 * scaled up, big ones down), multiples of 4.
 */
export function importSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const k = maxSide / Math.max(width, height);
  const fit = (v: number) =>
    Math.max(MIN_IMPORT_SIDE, Math.floor((v * k) / 4) * 4);
  return { width: fit(width), height: fit(height) };
}

const MIN_IMPORT_SIDE = 64;

/** Guess how an image encodes terrain. */
export function detectImageMode(img: RgbaImage): Exclude<ImageMode, "auto"> {
  const { data } = img;
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 20000));
  let samples = 0;
  let grey = 0;
  let gameWater = 0;
  let gameLand = 0;
  for (let i = 0; i < n; i += step) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    samples++;
    if (a < 20 || b === 106) gameWater++;
    else if (b >= 140 && b <= 200) gameLand++;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 12) grey++;
  }
  if (grey / samples > 0.95) return "heightmap";
  // The map generator's own source images: water is exactly blue 106 (or
  // transparent) and land blue sits in 140-200.
  if (gameWater / samples > 0.15 && (gameWater + gameLand) / samples > 0.97) {
    return "game";
  }
  return "picture";
}

/** One pixel of an ordinary map picture → [kind, elevation]. */
function pictureTile(
  r: number,
  g: number,
  b: number,
  a: number,
): [number, number] {
  if (a < 20) return [TERRAIN_WATER, 0];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  // Water: blue (or cyan) dominates.
  if (b > r + 15 && b >= g - 10 && sat > 0.18) return [TERRAIN_WATER, 0];
  const light = (r + g + b) / 3;
  // Snow / rock: bright or grey, unsaturated.
  if (sat < 0.15) {
    if (light > 200) return [TERRAIN_LAND, 28];
    if (light > 120) return [TERRAIN_LAND, 22];
    return [TERRAIN_LAND, 14];
  }
  // Greens are lowland (darker green = lower), yellows/browns hills.
  if (g >= r && g >= b) {
    return [TERRAIN_LAND, Math.round(1 + (light / 255) * 7)];
  }
  if (r >= g && g > b) {
    // Tan / brown: highland, darker brown higher.
    return [TERRAIN_LAND, Math.round(18 - (light / 255) * 7)];
  }
  return [TERRAIN_LAND, 5];
}

/**
 * Turn an image into an editable map at the image's size (scale it first
 * with importSize). Modes:
 *  - picture: any map picture: blue is water, greens plains, browns hills,
 *    grey/white mountains;
 *  - heightmap: greyscale, dark is low, below `seaLevel` is sea;
 *  - game: the map generator's own format (blue 106 / transparent water,
 *    land height from blue 140-200, black impassable).
 */
export function imageToMap(
  img: RgbaImage,
  opts: ImageImportOptions = {},
): EditableMap {
  const mode =
    !opts.mode || opts.mode === "auto" ? detectImageMode(img) : opts.mode;
  const w = img.width - (img.width % 4);
  const h = img.height - (img.height % 4);
  const m = blankMap(w, h);
  const sea = opts.seaLevel ?? 60;
  const { data } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * img.width + x) * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const a = data[p + 3];
      const i = y * w + x;
      let kind: number;
      let elev = 0;
      if (mode === "game") {
        if (a < 20 || b === 106) kind = TERRAIN_WATER;
        else if (r === 0 && g === 0 && b === 0) kind = TERRAIN_IMPASSABLE;
        else {
          kind = TERRAIN_LAND;
          elev = Math.floor((Math.min(200, Math.max(140, b)) - 140) / 2);
        }
      } else if (mode === "heightmap") {
        const v = (r + g + b) / 3;
        if (a < 20 || v < sea) kind = TERRAIN_WATER;
        else {
          kind = TERRAIN_LAND;
          elev = Math.round(((v - sea) / Math.max(1, 255 - sea)) * 30);
        }
      } else {
        [kind, elev] = pictureTile(r, g, b, a);
      }
      m.kind[i] = kind;
      m.elevation[i] = Math.min(30, elev);
    }
  }
  // Pictures give noisy heights (labels, outlines, shading): smooth them.
  if (mode === "picture") smoothElevation(m, 2);
  return m;
}

/** Box-blur land elevation (radius r), water and borders untouched. */
function smoothElevation(m: EditableMap, r: number): void {
  const { width: w, height: h, kind, elevation } = m;
  const out = new Uint8Array(elevation);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (kind[i] !== TERRAIN_LAND) continue;
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (kind[j] !== TERRAIN_LAND) continue;
          sum += elevation[j];
          n++;
        }
      }
      out[i] = Math.round(sum / n);
    }
  }
  m.elevation.set(out);
}

// ---------------------------------------------------- automatic terrain

/** Land distance (tiles) to the nearest water, by BFS from the coast. */
export function distanceToCoast(m: EditableMap): Int32Array {
  const { width: w, height: h, kind } = m;
  const dist = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let i = 0; i < w * h; i++) {
    if (kind[i] !== TERRAIN_LAND) {
      dist[i] = 0;
      continue;
    }
    const x = i % w;
    const y = (i - x) / w;
    if (
      x === 0 ||
      y === 0 ||
      x === w - 1 ||
      y === h - 1 ||
      kind[i - 1] !== TERRAIN_LAND ||
      kind[i + 1] !== TERRAIN_LAND ||
      kind[i - w] !== TERRAIN_LAND ||
      kind[i + w] !== TERRAIN_LAND
    ) {
      dist[i] = 1;
      queue[tail++] = i;
    }
  }
  let head = 0;
  while (head < tail) {
    const c = queue[head++];
    const x = c % w;
    const nbs = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w];
    for (const t of nbs) {
      if (t < 0 || t >= w * h || dist[t] !== -1) continue;
      dist[t] = dist[c] + 1;
      queue[tail++] = t;
    }
  }
  return dist;
}

/**
 * Automatic relief: realistic heights for land that has none (or to
 * enrich it). Lowlands along the coasts, hills further in, and ridged
 * mountain ranges in the interior, with the existing heights blended in.
 * `strength` 0-1 scales how mountainous the result is.
 */
export function autoRelief(
  m: EditableMap,
  seed: number,
  strength = 0.6,
): Uint8Array {
  const { width: w, height: h, kind, elevation } = m;
  const dist = distanceToCoast(m);
  let maxDist = 1;
  for (let i = 0; i < w * h; i++) if (dist[i] > maxDist) maxDist = dist[i];
  const scale = 5 / Math.max(w, h);
  const out = new Uint8Array(elevation);
  for (let i = 0; i < w * h; i++) {
    if (kind[i] !== TERRAIN_LAND) continue;
    const x = i % w;
    const y = (i - x) / w;
    // 0 at the coast → 1 deep inland (soft, so big continents get plains).
    const inland = Math.min(1, dist[i] / Math.max(6, maxDist * 0.6));
    const base = fbm(x * scale, y * scale, seed);
    // Ridged noise: sharp mountain chains.
    const r =
      1 - Math.abs(fbm(x * scale * 2.2, y * scale * 2.2, seed + 77) * 2 - 1);
    const ridge = r * r * r;
    const hills = base * 10 * inland;
    const peaks = ridge * 24 * Math.pow(inland, 0.8) * (0.4 + strength);
    const auto = Math.min(
      30,
      1 + hills * (0.5 + strength) + peaks * (base > 0.45 ? 1 : 0.55),
    );
    // Keep any relief the source already had.
    out[i] = Math.round(
      Math.min(30, Math.max(elevation[i], auto * 0.75 + elevation[i] * 0.5)),
    );
  }
  return out;
}

/** True when nearly all land is at one height (a flat picture). */
export function isFlat(m: EditableMap): boolean {
  let land = 0;
  let varied = 0;
  for (let i = 0; i < m.kind.length; i++) {
    if (m.kind[i] !== TERRAIN_LAND) continue;
    land++;
    if (m.elevation[i] >= 10) varied++;
  }
  return land > 0 && varied / land < 0.05;
}

// ---------------------------------------------------- automatic nations

/**
 * Pick `count` spawn points spread over the land: farthest-point sampling
 * over random land tiles, skipping islands too small to grow on.
 */
export function autoNationSpots(
  m: EditableMap,
  count: number,
  seed: number,
  avoid: { x: number; y: number }[] = [],
): { x: number; y: number }[] {
  const { width: w, height: h, kind } = m;
  // Landmass sizes.
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(w * h);
  let landTotal = 0;
  for (let i = 0; i < w * h; i++) {
    if (kind[i] !== TERRAIN_LAND || comp[i] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    comp[i] = id;
    while (head < tail) {
      const c = queue[head++];
      const x = c % w;
      const nbs = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w];
      for (const t of nbs) {
        if (t >= 0 && t < w * h && kind[t] === TERRAIN_LAND && comp[t] === -1) {
          comp[t] = id;
          queue[tail++] = t;
        }
      }
    }
    sizes.push(tail);
    landTotal += tail;
  }
  if (landTotal === 0 || count <= 0) return [];
  const minSize = Math.max(30, landTotal * 0.004);
  const dist = distanceToCoast(m);
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const candidates: number[] = [];
  for (let tries = 0; tries < 200000 && candidates.length < 6000; tries++) {
    const i = Math.floor(rnd() * w * h);
    // Land, a few tiles from the coast, on a landmass worth spawning on.
    if (kind[i] === TERRAIN_LAND && sizes[comp[i]] >= minSize && dist[i] >= 3) {
      candidates.push(i);
    }
  }
  const chosen: { x: number; y: number }[] = [];
  const minD = new Float64Array(candidates.length).fill(Infinity);
  const update = (px: number, py: number) => {
    candidates.forEach((c, k) => {
      const dx = (c % w) - px;
      const dy = Math.floor(c / w) - py;
      minD[k] = Math.min(minD[k], dx * dx + dy * dy);
    });
  };
  for (const a of avoid) update(a.x, a.y);
  for (let n = 0; n < count && candidates.length > 0; n++) {
    let best = 0;
    if (chosen.length === 0 && avoid.length === 0) {
      best = Math.floor(rnd() * candidates.length);
    } else {
      for (let k = 1; k < candidates.length; k++) {
        if (minD[k] > minD[best]) best = k;
      }
      if (minD[best] === 0) break;
    }
    const c = candidates[best];
    const p = { x: c % w, y: Math.floor(c / w) };
    chosen.push(p);
    update(p.x, p.y);
  }
  return chosen;
}
