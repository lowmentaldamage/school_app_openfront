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

import { IMPASSABLE_MAGNITUDE, isLandByte, magnitudeOf } from "./TerrainCodec";

export interface HeightfieldOptions {
  /** Box-blur radius in tiles (0 disables smoothing). */
  blurRadius: number;
  /** Blur passes; 2–3 passes approximate a gaussian. */
  blurPasses: number;
  /** Global vertical exaggeration. */
  verticalScale: number;
}

export const DEFAULT_HEIGHTFIELD_OPTIONS: HeightfieldOptions = {
  blurRadius: 2,
  blurPasses: 2,
  verticalScale: 1,
};

/** Raw heights above this keep sharp peaks after smoothing. */
const MOUNTAIN_PEAK_FROM = 6;
/** Share of the blurred-away peak height given back (0..1). */
const PEAK_RESTORE = 0.6;

/** Minimum land height after smoothing, so coasts stay above water. */
export const MIN_LAND_HEIGHT = 0.12;
/** Maximum water height after smoothing, so water stays below the surface. */
export const MAX_WATER_HEIGHT = -0.08;

/** Raw (unsmoothed) elevation of one terrain byte, in tiles. */
export function rawHeight(terrainByte: number): number {
  const m = magnitudeOf(terrainByte);
  if (!isLandByte(terrainByte)) {
    // Water magnitude is distance-to-land; deepen gently and cap.
    return -(0.35 + Math.min(m, 24) * 0.14);
  }
  // Exaggerated relief: on a map thousands of tiles wide, true-to-scale
  // mountains would be invisible bumps.
  if (m >= IMPASSABLE_MAGNITUDE) return 34;
  if (m < 10) return 0.3 + m * 0.1; // plains: 0.3 … 1.2
  if (m < 20) return 1.3 + (m - 10) * 0.45; // highland: 1.3 … 5.35
  return 6.0 + (m - 20) * 2.3; // mountains: 6.0 … 31.3
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

  static fromTerrain(
    terrain: Uint8Array,
    width: number,
    height: number,
    options: HeightfieldOptions = DEFAULT_HEIGHTFIELD_OPTIONS,
  ): Heightfield {
    if (terrain.length !== width * height) {
      throw new Error(
        `Heightfield: terrain has ${terrain.length} bytes, expected ${width * height}`,
      );
    }
    const h = new Float32Array(width * height);
    for (let i = 0; i < h.length; i++) h[i] = rawHeight(terrain[i]);

    if (options.blurRadius > 0) {
      const scratch = new Float32Array(Math.max(width, height));
      for (let p = 0; p < options.blurPasses; p++) {
        blurRows(h, width, height, options.blurRadius, scratch);
        blurCols(h, width, height, options.blurRadius, scratch);
      }
    }

    // Blurring pulls coasts toward sea level from both sides; clamp so the
    // land/water classification of every tile is preserved exactly.
    // Mountain peaks get most of their height back, so ranges keep sharp
    // summits while the slopes below stay smooth.
    const s = options.verticalScale;
    for (let i = 0; i < h.length; i++) {
      const raw = rawHeight(terrain[i]);
      if (raw > MOUNTAIN_PEAK_FROM && raw > h[i]) {
        h[i] += (raw - h[i]) * PEAK_RESTORE;
      }
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
}

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
