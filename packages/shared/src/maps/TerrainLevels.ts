/**
 * Terrain height levels: 0 = ground (lowest land), 100 = mountain tops.
 *
 * The simulation keeps its 31 elevation steps (the packed map's magnitude,
 * 0-30): plains < 10, highland < 20, mountains ≥ 20 drive the gameplay
 * rules and stay deterministic. Height *drawing* uses 0-100, so the
 * 3D terrain shows smooth slopes instead of 31 terraces:
 *
 *  - maps made from height data store their real levels in height.bin
 *    (and height4x.bin for compact games), one byte per tile;
 *  - every other map gets levels derived from its magnitudes by smoothing
 *    across land (deriveLevels).
 */

/** Mountain tops. Ground is 0. */
export const MAX_LEVEL = 100;
export const TERRAIN_LEVELS = MAX_LEVEL + 1;
/** Highest land magnitude in the packed map format. */
export const MAX_MAGNITUDE = 30;

/** Level (0-100) → packed land magnitude (0-30). */
export function levelToMagnitude(level: number): number {
  return Math.min(
    MAX_MAGNITUDE,
    Math.max(0, Math.round((level * MAX_MAGNITUDE) / MAX_LEVEL)),
  );
}

/** Packed land magnitude (0-30) → level (0-100). Round-trips exactly. */
export function magnitudeToLevel(magnitude: number): number {
  return Math.min(
    MAX_LEVEL,
    Math.max(0, Math.round((magnitude * MAX_LEVEL) / MAX_MAGNITUDE)),
  );
}

const LAND = 0x80;
const IMPASSABLE = 0b10011111;

/**
 * 100 levels for a map that only has magnitudes: each land tile's level is
 * the average magnitude of the land around it (two box-blur passes of
 * radius `r`, water ignored), so the 31 steps become smooth slopes. Tiles
 * stay within `maxShift` magnitude steps of their own value, so a plain
 * never looks like a hill. Water and impassable tiles are 0 too (the map
 * bytes tell land from water).
 */
export function deriveLevels(
  packed: Uint8Array,
  width: number,
  height: number,
  r = 2,
  maxShift = 1,
): Uint8Array {
  const n = width * height;
  // Own magnitude per tile; 255 = not (passable) land.
  const own = new Uint8Array(n);
  const cur = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = packed[i];
    if (b & LAND && b !== IMPASSABLE) {
      own[i] = b & 0x1f;
      cur[i] = own[i];
    } else own[i] = 255;
  }
  // Scratch for the row pass, reused by both blur passes.
  const rowV = new Float32Array(n);
  const rowW = new Uint8Array(n);
  for (let pass = 0; pass < 2; pass++) {
    blurLandInPlace(cur, own, width, height, r, rowV, rowW);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const m = own[i];
    if (m === 255) continue;
    const v = Math.min(m + maxShift, Math.max(m - maxShift, cur[i]));
    out[i] = Math.min(
      MAX_LEVEL,
      Math.max(0, Math.round((v * MAX_LEVEL) / MAX_MAGNITUDE)),
    );
  }
  return out;
}

/**
 * Separable box blur of the land values in `v` (water ignored, water
 * cells unchanged), in place: rows into the scratch sums, columns back.
 */
function blurLandInPlace(
  v: Float32Array,
  own: Uint8Array,
  w: number,
  h: number,
  r: number,
  rowV: Float32Array,
  rowW: Uint8Array,
): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sv = 0;
    let sw = 0;
    for (let x = 0; x <= r && x < w; x++) {
      if (own[row + x] !== 255) {
        sv += v[row + x];
        sw++;
      }
    }
    for (let x = 0; x < w; x++) {
      rowV[row + x] = sv;
      rowW[row + x] = sw;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w && own[row + add] !== 255) {
        sv += v[row + add];
        sw++;
      }
      if (sub >= 0 && own[row + sub] !== 255) {
        sv -= v[row + sub];
        sw--;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let sv = 0;
    let sw = 0;
    for (let y = 0; y <= r && y < h; y++) {
      sv += rowV[y * w + x];
      sw += rowW[y * w + x];
    }
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (own[i] !== 255 && sw > 0) v[i] = sv / sw;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) {
        sv += rowV[add * w + x];
        sw += rowW[add * w + x];
      }
      if (sub >= 0) {
        sv -= rowV[sub * w + x];
        sw -= rowW[sub * w + x];
      }
    }
  }
}

/** Half-size levels (2×2 average of the land tiles), like map4x. */
export function halveLevels(
  levels: Uint8Array,
  land: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const w2 = width >> 1;
  const h2 = height >> 1;
  const out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let s = 0;
      let c = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (2 * y + dy) * width + 2 * x + dx;
          if (land[i]) {
            s += levels[i];
            c++;
          }
        }
      }
      out[y * w2 + x] = c > 0 ? Math.round(s / c) : 0;
    }
  }
  return out;
}
