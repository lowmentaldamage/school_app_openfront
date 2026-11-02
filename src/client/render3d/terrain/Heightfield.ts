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
  if (m >= IMPASSABLE_MAGNITUDE) return 10;
  if (m < 10) return 0.3 + m * 0.09; // plains: 0.3 … 1.11
  if (m < 20) return 1.2 + (m - 10) * 0.22; // highland: 1.2 … 3.18
  return 3.4 + (m - 20) * 0.55; // mountains: 3.4 … 9.45
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
    const s = options.verticalScale;
    for (let i = 0; i < h.length; i++) {
      const v = h[i] * s;
      h[i] = isLandByte(terrain[i])
        ? Math.max(v, MIN_LAND_HEIGHT)
        : Math.min(v, MAX_WATER_HEIGHT);
    }
    return new Heightfield(width, height, h);
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
