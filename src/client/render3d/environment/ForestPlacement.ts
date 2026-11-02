/**
 * ForestPlacement — deterministic tree scattering from terrain. Pure (no
 * three.js) so it is unit tested and identical on every client.
 *
 * Trees grow in clusters (value noise), never on water, beaches, snow or
 * bare rock, are densest in highlands, sparse on high slopes. Each tree
 * gets a kind (conifer / broadleaf, by altitude), a size, a yaw and a
 * foliage tint.
 */

import type { Heightfield } from "../terrain/Heightfield";
import { Biome, biomeOf } from "../terrain/TerrainCodec";

export interface TreeInstance {
  x: number;
  y: number;
  /** Ground height (world units). */
  h: number;
  conifer: boolean;
  size: number;
  yaw: number;
  /** Foliage tint 0..1 (dark green → olive). */
  tint: number;
}

export interface ForestOptions {
  /** Sample every `stride` tiles (jittered). Larger = fewer trees. */
  stride: number;
  /** Global density multiplier. */
  density: number;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Forest cover 0..1 at a tile (clustered). */
export function forestCover(x: number, y: number): number {
  return (
    valueNoise(x / 38, y / 38, 0x51ed) * 0.65 +
    valueNoise(x / 11, y / 11, 0x2b7) * 0.35
  );
}

export function placeTrees(
  terrain: Uint8Array,
  hf: Heightfield,
  options: ForestOptions,
): TreeInstance[] {
  const out: TreeInstance[] = [];
  const { width, height } = hf;
  const s = Math.max(1, options.stride);
  for (let gy = 0; gy < height; gy += s) {
    for (let gx = 0; gx < width; gx += s) {
      const jx = hash2(gx, gy, 11);
      const jy = hash2(gx, gy, 23);
      const x = Math.min(width - 0.5, gx + jx * s);
      const y = Math.min(height - 0.5, gy + jy * s);
      const ref = Math.floor(y) * width + Math.floor(x);
      const biome = biomeOf(terrain[ref]);
      let base: number;
      if (biome === Biome.Plains) base = 0.55;
      else if (biome === Biome.Highland) base = 0.85;
      else if (biome === Biome.Mountain) base = 0.3;
      else continue;
      const h = hf.sample(x, y);
      // No trees on beaches or above the snow line.
      if (h < 0.42 || h > 6.4) continue;
      const slope =
        Math.abs(hf.sample(x + 1, y) - hf.sample(x - 1, y)) +
        Math.abs(hf.sample(x, y + 1) - hf.sample(x, y - 1));
      if (slope > 1.6) continue;
      const cover = forestCover(x, y);
      const p =
        base * options.density * Math.max(0, (cover - 0.42) / 0.58) * 2.2;
      if (hash2(gx, gy, 37) >= p) continue;
      const r = hash2(gx, gy, 41);
      out.push({
        x,
        y,
        h,
        conifer: h > 2.2 || r < 0.35,
        size: 0.75 + hash2(gx, gy, 53) * 0.6,
        yaw: hash2(gx, gy, 67) * Math.PI * 2,
        tint: hash2(gx, gy, 71),
      });
    }
  }
  return out;
}
