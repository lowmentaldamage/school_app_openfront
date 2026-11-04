/**
 * MapBuilder — turns an editable terrain grid into the game's map files,
 * exactly like the Go map generator (map-generator/map_generator.go):
 *
 *   map.bin    width × height, one packed byte per tile
 *   map4x.bin  width/2 × height/2 (water wins, so rivers survive)
 *   map16x.bin width/4 × height/4
 *
 * Packed byte: bit 7 land, bit 6 shoreline, bit 5 ocean, bits 0-4
 * magnitude (land: elevation 0-30, 31 = impassable; water: distance to
 * land ÷ 2). The largest water body is the ocean.
 *
 * Also decodes a packed map back into an editable grid. Pure, no DOM, so
 * the editor (client) and the map store (server) share it.
 */

import {
  deriveLevels,
  halveLevels,
  levelToMagnitude,
  magnitudeToLevel,
} from "./TerrainLevels";

export const TERRAIN_WATER = 0;
export const TERRAIN_LAND = 1;
export const TERRAIN_IMPASSABLE = 2;

/**
 * Editable map: kind and land height level (0 ground - 100 mountain tops, see TerrainLevels) per
 * tile, row-major. The packed files get the matching 0-30 magnitude.
 */
export interface EditableMap {
  width: number;
  height: number;
  kind: Uint8Array;
  elevation: Uint8Array;
}

export interface BuiltMap {
  width: number;
  height: number;
  map: Uint8Array;
  map4x: Uint8Array;
  map16x: Uint8Array;
  numLandTiles: number;
  numLandTiles4x: number;
  numLandTiles16x: number;
  /** Height levels (0-100) per tile at full and half size (height.bin). */
  levels: Uint8Array;
  levels4x: Uint8Array;
}

/** Largest supported side (tiles). */
export const MAX_MAP_SIDE = 3000;
export const MIN_MAP_SIDE = 64;

export function blankMap(width: number, height: number): EditableMap {
  const w = width - (width % 4);
  const h = height - (height % 4);
  return {
    width: w,
    height: h,
    kind: new Uint8Array(w * h),
    elevation: new Uint8Array(w * h),
  };
}

/**
 * Decode a packed map.bin into an editable grid. With `levels`
 * (height.bin) the land keeps its 100-level heights; without, levels are
 * derived from the magnitudes.
 */
export function decodeMap(
  packed: Uint8Array,
  width: number,
  height: number,
  levels?: Uint8Array | null,
  /** Without levels: smooth the 31 steps (false: exact steps only). */
  smooth = true,
): EditableMap {
  const lv =
    levels && levels.length === width * height
      ? levels
      : smooth
        ? deriveLevels(packed, width, height)
        : new Uint8Array(width * height);
  const m: EditableMap = {
    width,
    height,
    kind: new Uint8Array(width * height),
    elevation: new Uint8Array(width * height),
  };
  for (let i = 0; i < width * height; i++) {
    const b = packed[i];
    if (b & 0x80) {
      const mag = b & 0x1f;
      if (mag === 31) m.kind[i] = TERRAIN_IMPASSABLE;
      else {
        m.kind[i] = TERRAIN_LAND;
        m.elevation[i] =
          levels && levels.length === width * height
            ? Math.min(100, lv[i])
            : smooth
              ? lv[i]
              : magnitudeToLevel(mag);
      }
    }
  }
  return m;
}

/** Build all three packed map files from an editable grid. */
export function buildMap(src: EditableMap): BuiltMap {
  const w = src.width - (src.width % 4);
  const h = src.height - (src.height % 4);
  if (w < MIN_MAP_SIDE || h < MIN_MAP_SIDE) throw new Error("map too small");
  if (w > MAX_MAP_SIDE || h > MAX_MAP_SIDE) throw new Error("map too large");
  // Crop to multiples of 4 (the downscales need it).
  const kind = new Uint8Array(w * h);
  const elev = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    kind.set(src.kind.subarray(y * src.width, y * src.width + w), y * w);
    elev.set(src.elevation.subarray(y * src.width, y * src.width + w), y * w);
  }
  const full = pack(kind, elev, w, h);
  const [k4, e4] = miniMap(kind, elev, w, h);
  const quarter = pack(k4, e4, w / 2, h / 2);
  const [k16, e16] = miniMap(k4, e4, w / 2, h / 2);
  const sixteenth = pack(k16, e16, w / 4, h / 4);
  return {
    width: w,
    height: h,
    map: full.data,
    map4x: quarter.data,
    map16x: sixteenth.data,
    numLandTiles: full.land,
    numLandTiles4x: quarter.land,
    numLandTiles16x: sixteenth.land,
    levels: landLevels(kind, elev),
    levels4x: halveLevels(
      landLevels(kind, elev),
      kind.map((k) => (k === TERRAIN_LAND ? 1 : 0)),
      w,
      h,
    ),
  };
}

/** Level per tile, 0 where there is no (passable) land. */
function landLevels(kind: Uint8Array, elev: Uint8Array): Uint8Array {
  const out = new Uint8Array(kind.length);
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] === TERRAIN_LAND) out[i] = Math.min(100, elev[i]);
  }
  return out;
}

function miniMap(
  kind: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): [Uint8Array, Uint8Array] {
  const mw = w / 2;
  const mh = h / 2;
  const k = new Uint8Array(mw * mh).fill(255); // 255 = unset
  const e = new Uint8Array(mw * mh);
  // Same visiting order as the generator (x outer, y inner).
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const mx = x >> 1;
      const my = y >> 1;
      if (mx >= mw || my >= mh) continue;
      const d = my * mw + mx;
      const s = y * w + x;
      if (k[d] === TERRAIN_WATER) continue;
      if (kind[s] === TERRAIN_WATER) {
        k[d] = TERRAIN_WATER;
        e[d] = 0;
        continue;
      }
      if (k[d] === TERRAIN_IMPASSABLE) continue;
      k[d] = kind[s];
      e[d] = elev[s];
    }
  }
  return [k, e];
}

/** Shoreline, ocean, water depth, then pack. */
function pack(
  kind: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): { data: Uint8Array; land: number } {
  const n = w * h;
  const ocean = new Uint8Array(n);
  const shore = new Uint8Array(n);
  const dist = new Int32Array(n).fill(0);

  // Water bodies: the largest is the ocean.
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best = -1;
  let bestSize = 0;
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (kind[i] !== TERRAIN_WATER || comp[i] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    comp[i] = id;
    while (head < tail) {
      const c = queue[head++];
      const x = c % w;
      const y = (c - x) / w;
      const nb = [
        x > 0 ? c - 1 : -1,
        x < w - 1 ? c + 1 : -1,
        y > 0 ? c - w : -1,
        y < h - 1 ? c + w : -1,
      ];
      for (const t of nb) {
        if (t >= 0 && kind[t] === TERRAIN_WATER && comp[t] === -1) {
          comp[t] = id;
          queue[tail++] = t;
        }
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      best = id;
    }
    id++;
  }
  if (best >= 0) {
    for (let i = 0; i < n; i++) if (comp[i] === best) ocean[i] = 1;
  }

  // Shorelines, and BFS distance to land from shoreline water.
  let head = 0;
  let tail = 0;
  const seen = new Uint8Array(n);
  if (best >= 0) {
    for (let i = 0; i < n; i++) {
      const k = kind[i];
      if (k === TERRAIN_IMPASSABLE) continue;
      const x = i % w;
      const y = (i - x) / w;
      const nbs = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ];
      for (const t of nbs) {
        if (t < 0) continue;
        if (
          (k === TERRAIN_LAND && kind[t] === TERRAIN_WATER) ||
          (k === TERRAIN_WATER && kind[t] === TERRAIN_LAND)
        ) {
          shore[i] = 1;
          break;
        }
      }
      if (k === TERRAIN_WATER && shore[i]) {
        queue[tail++] = i;
        seen[i] = 1;
      }
    }
    while (head < tail) {
      const c = queue[head++];
      const x = c % w;
      const y = (c - x) / w;
      // Generator order: (0,+1), (+1,0), (0,-1), (-1,0).
      const nbs = [
        y < h - 1 ? c + w : -1,
        x < w - 1 ? c + 1 : -1,
        y > 0 ? c - w : -1,
        x > 0 ? c - 1 : -1,
      ];
      for (const t of nbs) {
        if (t >= 0 && !seen[t] && kind[t] === TERRAIN_WATER) {
          seen[t] = 1;
          dist[t] = dist[c] + 1;
          queue[tail++] = t;
        }
      }
    }
  }

  const data = new Uint8Array(n);
  let land = 0;
  for (let i = 0; i < n; i++) {
    const k = kind[i];
    if (k === TERRAIN_IMPASSABLE) {
      data[i] = 0b10011111;
      continue;
    }
    let b = 0;
    if (k === TERRAIN_LAND) {
      b |= 0x80;
      land++;
    }
    if (shore[i]) b |= 0x40;
    if (ocean[i]) b |= 0x20;
    if (k === TERRAIN_LAND) {
      b |= levelToMagnitude(elev[i]);
    } else {
      let d = dist[i];
      // Water next to impassable terrain renders deep.
      const x = i % w;
      const y = (i - x) / w;
      if (
        (x > 0 && kind[i - 1] === TERRAIN_IMPASSABLE) ||
        (x < w - 1 && kind[i + 1] === TERRAIN_IMPASSABLE) ||
        (y > 0 && kind[i - w] === TERRAIN_IMPASSABLE) ||
        (y < h - 1 && kind[i + w] === TERRAIN_IMPASSABLE)
      ) {
        d = 20;
      }
      b |= Math.min(31, Math.ceil(d / 2));
    }
    data[i] = b;
  }
  return { data, land };
}
