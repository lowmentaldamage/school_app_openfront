/**
 * Heightfield — turns the 2D tile terrain into a smooth elevation surface.
 *
 * Heights are in world units where 1 unit = 1 tile. Sea level is y = 0:
 * land is always > 0 and water < 0, so the water plane at y = 0 never
 * covers land and never exposes the sea floor above the surface.
 *
 * Heights are stored per tile (row-major, width × height) and smoothed with
 * a separable box blur so mountains read as slopes instead of terraces.
 * The blur runs in place with a single row/column scratch buffer, so the
 * peak memory is one Float32 per tile plus O(max(w, h)).
 */

import {
  MAX_LEVEL,
  MAX_MAGNITUDE,
} from "@laukolaroser/shared/maps/TerrainLevels";
import { IMPASSABLE_MAGNITUDE, isLandByte, magnitudeOf } from "./TerrainCodec";

export interface HeightfieldOptions {
  /** Box-blur radius in tiles (0 disables smoothing). */
  blurRadius: number;
  /** Blur passes; 2–3 passes approximate a gaussian. */
  blurPasses: number;
  /** Global vertical exaggeration. */
  verticalScale: number;
  /** Steepest rise in height per tile (see limitSlope); unset: no limit. */
  maxSlope?: number;
}

export const DEFAULT_HEIGHTFIELD_OPTIONS: HeightfieldOptions = {
  blurRadius: 2,
  blurPasses: 2,
  verticalScale: 1,
  maxSlope: 1.6,
};

/** Raw heights above this keep sharp peaks after smoothing. */
const MOUNTAIN_PEAK_FROM = 6;
/** Share of the blurred-away peak height given back (0..1). */
const PEAK_RESTORE = 0.6;

/**
 * Lowers every point so it is at most `slope` per tile above any other
 * point (chamfer distance passes, diagonal = √2 tiles). Only lowers, so
 * valleys and plains are untouched; peaks keep their height when the
 * ground around them rises to meet them.
 */
export function limitSlope(
  h: Float32Array,
  width: number,
  height: number,
  slope: number,
): void {
  const d = slope * Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let v = h[i];
      if (x > 0 && h[i - 1] + slope < v) v = h[i - 1] + slope;
      if (y > 0) {
        const u = i - width;
        if (h[u] + slope < v) v = h[u] + slope;
        if (x > 0 && h[u - 1] + d < v) v = h[u - 1] + d;
        if (x < width - 1 && h[u + 1] + d < v) v = h[u + 1] + d;
      }
      h[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let v = h[i];
      if (x < width - 1 && h[i + 1] + slope < v) v = h[i + 1] + slope;
      if (y < height - 1) {
        const b = i + width;
        if (h[b] + slope < v) v = h[b] + slope;
        if (x < width - 1 && h[b + 1] + d < v) v = h[b + 1] + d;
        if (x > 0 && h[b - 1] + d < v) v = h[b - 1] + d;
      }
      h[i] = v;
    }
  }
}

/** Minimum land height after smoothing, so coasts stay above water. */
export const MIN_LAND_HEIGHT = 0.12;
/** Maximum water height after smoothing, so water stays below the surface. */
export const MAX_WATER_HEIGHT = -0.08;

/** Height of the highest layer (level 100), in tiles. */
export const TOP_HEIGHT = 42;
/** Height of the impassable peaks, above every layer. */
export const IMPASSABLE_HEIGHT = 46;

/**
 * Land height (tiles) for a layer, 0 ground to 100 mountain tops.
 * Three bands with growing steps, so plains stay low and flat, hills rise
 * and mountain tops are huge:
 *   plains   0-33   0.3 … 1.5  (0.036 per layer)
 *   highland 33-67  1.5 … 9    (0.225 per layer)
 *   mountain 67-100 9 … 42     (0.99 per layer)
 * Exaggerated relief: on a map thousands of tiles wide, true-to-scale
 * mountains would be invisible bumps. TerrainMaterial's terrainLevel()
 * is the inverse; keep them in step.
 */
export function levelHeight(level: number): number {
  const L = level < 0 ? 0 : level > MAX_LEVEL ? MAX_LEVEL : level;
  if (L < 100 / 3) return 0.3 + L * 0.036;
  if (L < 200 / 3) return 1.5 + (L - 100 / 3) * 0.225;
  return 9 + (L - 200 / 3) * ((TOP_HEIGHT - 9) / (100 / 3));
}

/** Land height (tiles) for a magnitude on the continuous 0-30 scale. */
export function landHeight(m: number): number {
  return levelHeight((m * MAX_LEVEL) / MAX_MAGNITUDE);
}

/**
 * Raw (unsmoothed) elevation of one terrain byte, in tiles. `level`
 * (0 ground - 100 mountain tops, see TerrainLevels) gives land 101 height
 * steps instead of the byte's 31.
 */
export function rawHeight(terrainByte: number, level?: number): number {
  const m = magnitudeOf(terrainByte);
  if (!isLandByte(terrainByte)) {
    // Water magnitude is distance-to-land; deepen gently and cap.
    return -(0.35 + Math.min(m, 24) * 0.14);
  }
  if (m >= IMPASSABLE_MAGNITUDE) return IMPASSABLE_HEIGHT;
  if (level !== undefined) return levelHeight(level);
  return landHeight(m);
}

export class Heightfield {
  readonly heights: Float32Array;

  private constructor(
    readonly width: number,
    readonly height: number,
    heights: Float32Array,
  ) {
    this.heights = heights;
  }

  /** A field from ready-made heights (tools and tests). */
  static fromHeights(
    heights: Float32Array,
    width: number,
    height: number,
  ): Heightfield {
    if (heights.length !== width * height) {
      throw new Error("Heightfield: heights do not match the size");
    }
    return new Heightfield(width, height, heights);
  }

  static fromTerrain(
    terrain: Uint8Array,
    width: number,
    height: number,
    options: HeightfieldOptions = DEFAULT_HEIGHTFIELD_OPTIONS,
    /** Height levels (0-100) per tile; missing: from the bytes. */
    levels?: Uint8Array | null,
  ): Heightfield {
    const lv = levels && levels.length === width * height ? levels : null;
    if (terrain.length !== width * height) {
      throw new Error(
        `Heightfield: terrain has ${terrain.length} bytes, expected ${width * height}`,
      );
    }
    const h = new Float32Array(width * height);
    for (let i = 0; i < h.length; i++) {
      h[i] = rawHeight(terrain[i], lv ? lv[i] : undefined);
    }

    if (options.blurRadius > 0) {
      const scratch = new Float32Array(Math.max(width, height));
      for (let p = 0; p < options.blurPasses; p++) {
        blurRows(h, width, height, options.blurRadius, scratch);
        blurCols(h, width, height, options.blurRadius, scratch);
      }
    }

    // Mountain peaks get most of their height back, so ranges keep sharp
    // summits while the slopes below stay smooth.
    for (let i = 0; i < h.length; i++) {
      const raw = rawHeight(terrain[i], lv ? lv[i] : undefined);
      if (raw > MOUNTAIN_PEAK_FROM && raw > h[i]) {
        h[i] += (raw - h[i]) * PEAK_RESTORE;
      }
    }
    // Huge mountain tops need a base to stand on: cap the slope (about
    // 58 degrees at 1.6) so a single mountain tile (common on maps without real height data) is a
    // massif, not a needle.
    if (options.maxSlope !== undefined) {
      limitSlope(h, width, height, options.maxSlope);
    }
    // Blurring pulls coasts toward sea level from both sides; clamp so the
    // land/water classification of every tile is preserved exactly.
    const s = options.verticalScale;
    for (let i = 0; i < h.length; i++) {
      const v = h[i] * s;
      h[i] = isLandByte(terrain[i])
        ? Math.max(v, MIN_LAND_HEIGHT)
        : Math.min(v, MAX_WATER_HEIGHT);
    }
    return new Heightfield(width, height, h);
  }

  private maxH = Number.NaN;

  /** Highest point of the field (cached). */
  maxHeight(): number {
    if (Number.isNaN(this.maxH)) {
      let m = 0;
      for (let i = 0; i < this.heights.length; i++) {
        if (this.heights[i] > m) m = this.heights[i];
      }
      this.maxH = m;
    }
    return this.maxH;
  }

  /** Height of the tile containing (x, y); coordinates are clamped. */
  tileHeight(x: number, y: number): number {
    const xi = clampInt(Math.floor(x), 0, this.width - 1);
    const yi = clampInt(Math.floor(y), 0, this.height - 1);
    return this.heights[yi * this.width + xi];
  }

  /**
   * Bilinear height at a continuous world position. Tile (x, y) covers
   * [x, x+1) × [y, y+1) and its sample sits at the tile centre.
   */
  sample(x: number, y: number): number {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = clampInt(Math.floor(fx), 0, this.width - 1);
    const y0 = clampInt(Math.floor(fy), 0, this.height - 1);
    const x1 = Math.min(x0 + 1, this.width - 1);
    const y1 = Math.min(y0 + 1, this.height - 1);
    const tx = clamp01(fx - x0);
    const ty = clamp01(fy - y0);
    const w = this.width;
    const a = this.heights[y0 * w + x0];
    const b = this.heights[y0 * w + x1];
    const c = this.heights[y1 * w + x0];
    const d = this.heights[y1 * w + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  private ceil: Float32Array | null = null;
  private ceilW = 0;
  private ceilH = 0;

  /**
   * A smooth "flight ceiling": the highest ground within about a cell
   * (CEILING_CELL tiles) around the point, blended between cells, so
   * aircraft cruise over mountains instead of tracing every ridge.
   * Never below the ground at the point's own cell. Built lazily once.
   */
  ceilingAt(x: number, y: number): number {
    if (this.ceil === null) this.buildCeiling();
    const c = this.ceil!;
    const fx = x / CEILING_CELL - 0.5;
    const fy = y / CEILING_CELL - 0.5;
    const x0 = clampInt(Math.floor(fx), 0, this.ceilW - 1);
    const y0 = clampInt(Math.floor(fy), 0, this.ceilH - 1);
    const x1 = Math.min(x0 + 1, this.ceilW - 1);
    const y1 = Math.min(y0 + 1, this.ceilH - 1);
    const tx = clamp01(fx - x0);
    const ty = clamp01(fy - y0);
    const w = this.ceilW;
    const a = c[y0 * w + x0];
    const b = c[y0 * w + x1];
    const d0 = c[y1 * w + x0];
    const d1 = c[y1 * w + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (d0 * (1 - tx) + d1 * tx) * ty;
  }

  private buildCeiling(): void {
    const cw = Math.max(1, Math.ceil(this.width / CEILING_CELL));
    const chh = Math.max(1, Math.ceil(this.height / CEILING_CELL));
    const cellMax = new Float32Array(cw * chh);
    for (let y = 0; y < this.height; y++) {
      const cy = Math.floor(y / CEILING_CELL) * cw;
      for (let x = 0; x < this.width; x++) {
        const i = cy + Math.floor(x / CEILING_CELL);
        const v = this.heights[y * this.width + x];
        if (v > cellMax[i]) cellMax[i] = v;
      }
    }
    // Each cell takes the max of its 3x3 neighbourhood.
    const out = new Float32Array(cw * chh);
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= chh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= cw) continue;
            const v = cellMax[yy * cw + xx];
            if (v > m) m = v;
          }
        }
        out[y * cw + x] = m;
      }
    }
    this.ceil = out;
    this.ceilW = cw;
    this.ceilH = chh;
  }
}

/** Cell size (tiles) of the flight ceiling grid. */
export const CEILING_CELL = 8;

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Running-sum box blur of each row, edge-clamped. */
function blurRows(
  h: Float32Array,
  w: number,
  rows: number,
  r: number,
  scratch: Float32Array,
): void {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < rows; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) scratch[x] = h[off + x];
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += scratch[clampInt(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      h[off + x] = sum * norm;
      sum += scratch[clampInt(x + r + 1, 0, w - 1)];
      sum -= scratch[clampInt(x - r, 0, w - 1)];
    }
  }
}

/** Running-sum box blur of each column, edge-clamped. */
function blurCols(
  h: Float32Array,
  w: number,
  rows: number,
  r: number,
  scratch: Float32Array,
): void {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < rows; y++) scratch[y] = h[y * w + x];
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += scratch[clampInt(k, 0, rows - 1)];
    for (let y = 0; y < rows; y++) {
      h[y * w + x] = sum * norm;
      sum += scratch[clampInt(y + r + 1, 0, rows - 1)];
      sum -= scratch[clampInt(y - r, 0, rows - 1)];
    }
  }
}
