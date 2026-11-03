/**
 * TerrainDetail — per-tile terrain data for the terrain fragment shader.
 *
 * The terrain mesh is sampled every `stride` tiles (2+ on big maps) and its
 * heights are blurred so the geometry reads as smooth slopes. Shading from
 * that mesh alone smears coastlines and relief across several tiles. This
 * texture keeps the map at full tile resolution, so every pixel is
 * lit and coloured from the real tile data regardless of mesh density:
 *
 *   R: lightly smoothed height (tiles)        → per-pixel normals and biomes
 *   G: land mask (1 land, 0 water)            → crisp coastline at the 0.5
 *                                               contour of linear filtering
 *
 * Two half floats per tile (4 bytes). Pure (no three.js) so it is unit
 * tested; TerrainMaterial uploads it as an RG16F texture.
 */

import { Heightfield } from "./Heightfield";
import { isLandByte } from "./TerrainCodec";

export interface TerrainDetailData {
  /** Texture size in texels (map size × scale). */
  width: number;
  height: number;
  /** Texels per tile along each axis (1 = one texel per tile). */
  scale: number;
  /** Interleaved [height, land] per texel, row-major. */
  values: Float32Array;
}

/** Light smoothing: keeps tile-scale relief, removes terrace steps. */
export const DETAIL_BLUR = { blurRadius: 1, blurPasses: 1, verticalScale: 1 };

/** The lightly smoothed heightfield the detail texture is built from. */
export function detailHeightfield(
  terrain: Uint8Array,
  width: number,
  height: number,
): Heightfield {
  return Heightfield.fromTerrain(terrain, width, height, DETAIL_BLUR);
}

export function buildTerrainDetail(
  terrain: Uint8Array,
  hf: Heightfield,
): TerrainDetailData {
  const { width, height } = hf;
  const values = new Float32Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    values[i * 2] = hf.heights[i];
    values[i * 2 + 1] = isLandByte(terrain[i]) ? 1 : 0;
  }
  return { width, height, scale: 1, values };
}

/**
 * Render-side upscale (gameplay tiles are untouched): `scale` texels per
 * tile, with
 *  - a smoothed land field, so coastlines round off instead of following
 *    the tile staircase, while every sub-texel keeps its tile's side of the
 *    0.5 contour (no island or strait is lost or invented);
 *  - fractal elevation detail scaled by terrain (flat plains, rugged
 *    mountains), so close-up relief has more than one height per tile.
 * Deterministic: integer-hash noise, same result on every machine.
 */
export function upscaleTerrainDetail(
  base: TerrainDetailData,
  scale: number,
): TerrainDetailData {
  if (scale <= 1) return base;
  const bw = base.width;
  const bh = base.height;
  const W = bw * scale;
  const H = bh * scale;
  const src = base.values;

  // Smoothed land field at tile resolution (3x3 tent).
  const land = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let sum = 0;
      let wsum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= bh ? bh - 1 : y + dy;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= bw ? bw - 1 : x + dx;
          const wgt = (2 - Math.abs(dx)) * (2 - Math.abs(dy));
          sum += src[(yy * bw + xx) * 2 + 1] * wgt;
          wsum += wgt;
        }
      }
      land[y * bw + x] = sum / wsum;
    }
  }

  const values = new Float32Array(W * H * 2);
  const inv = 1 / scale;
  const noise = noiseTable();
  // Per-column bilinear setup, shared by every row.
  const cx0 = new Int32Array(W);
  const cx1 = new Int32Array(W);
  const cwx = new Float32Array(W);
  const ctx = new Int32Array(W);
  for (let X = 0; X < W; X++) {
    const fx = (X + 0.5) * inv - 0.5;
    const x0 = fx < 0 ? 0 : Math.floor(fx);
    cx0[X] = x0;
    cx1[X] = x0 + 1 < bw ? x0 + 1 : bw - 1;
    cwx[X] = fx < 0 ? 0 : fx - x0;
    ctx[X] = Math.min(bw - 1, Math.floor((X + 0.5) * inv));
  }
  for (let Y = 0; Y < H; Y++) {
    const fy = (Y + 0.5) * inv - 0.5;
    const ty = Math.min(bh - 1, Math.floor((Y + 0.5) * inv));
    const y0 = fy < 0 ? 0 : Math.floor(fy);
    const y1 = y0 + 1 < bh ? y0 + 1 : bh - 1;
    const wy = fy < 0 ? 0 : fy - y0;
    const r0 = y0 * bw;
    const r1 = y1 * bw;
    const nrow = (Y & NOISE_MASK) * NOISE_SIZE;
    let o = Y * W * 2;
    for (let X = 0; X < W; X++, o += 2) {
      const x0 = cx0[X];
      const x1 = cx1[X];
      const wx = cwx[X];
      const a = r0 + x0;
      const b = r0 + x1;
      const c = r1 + x0;
      const d = r1 + x1;
      const isLand = src[(ty * bw + ctx[X]) * 2 + 1] > 0.5;
      let l =
        (land[a] * (1 - wx) + land[b] * wx) * (1 - wy) +
        (land[c] * (1 - wx) + land[d] * wx) * wy;
      let h =
        (src[a * 2] * (1 - wx) + src[b * 2] * wx) * (1 - wy) +
        (src[c * 2] * (1 - wx) + src[d * 2] * wx) * wy;
      if (isLand) {
        if (l < 0.52) l = 0.52;
        // Roughness grows with elevation: plains ≈ flat, mountains rugged
        // with ridged crests (folded |noise| makes sharp edges, not bumps).
        const r = (h - 0.6) / 6;
        const rc = r < 0 ? 0 : r > 1 ? 1 : r;
        const n = noise[nrow + (X & NOISE_MASK)];
        const ridge = 1 - Math.abs(n * 2 - 1);
        h += (n - 0.5) * (rc * 0.7 + 0.02) + ridge * rc * rc * 0.9;
        if (h < 0.12) h = 0.12;
      } else {
        if (l > 0.48) l = 0.48;
        if (h > -0.08) h = -0.08;
      }
      values[o] = h;
      values[o + 1] = l;
    }
  }
  return { width: W, height: H, scale, values };
}

/** Texels per tile for this map: 2 when it fits the budget, else 1. */
export function detailScaleFor(
  mapWidth: number,
  mapHeight: number,
  maxTextureSize: number,
  texelBudget: number,
): number {
  const s = 2;
  if (mapWidth * s > maxTextureSize || mapHeight * s > maxTextureSize) return 1;
  if (mapWidth * mapHeight * s * s > texelBudget) return 1;
  return s;
}

const NOISE_SIZE = 256;
const NOISE_MASK = NOISE_SIZE - 1;
let noiseCache: Float32Array | null = null;

/** Tileable fBm (period 256 texels), built once. */
function noiseTable(): Float32Array {
  if (noiseCache !== null) return noiseCache;
  const t = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  const P = NOISE_SIZE;
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      // Octaves with integer frequencies over the period, so it tiles.
      t[y * P + x] =
        pnoise(x / 8, y / 8, P / 8) * 0.5 +
        pnoise(x / 4, y / 4, P / 4) * 0.3 +
        pnoise(x / 2, y / 2, P / 2) * 0.2;
    }
  }
  noiseCache = t;
  return t;
}

/** Value noise wrapping every `period` cells. */
function pnoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = xi % period;
  const y0 = yi % period;
  const x1 = (xi + 1) % period;
  const y1 = (yi + 1) % period;
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
