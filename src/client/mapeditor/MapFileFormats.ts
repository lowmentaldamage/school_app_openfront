/**
 * Height-data files the map editor can upload, next to ordinary images
 * (PNG, JPG, WebP, GIF, BMP, AVIF, SVG… go through the browser instead):
 *
 *  - TIFF / GeoTIFF (.tif .tiff): uncompressed, 8/16/32-bit integer or
 *    32-bit float, grey or RGB, strips (most DEM exports);
 *  - SRTM tiles (.hgt): 16-bit big-endian heights in metres;
 *  - ESRI ASCII grids (.asc): text DEMs;
 *  - Netpbm (.pgm .ppm .pbm .pnm): 8 or 16-bit, text or binary;
 *  - raw heightmaps (.raw .r16 .r8): square, 16-bit little-endian
 *    (Unity/World Machine/Gaea) or 8-bit;
 *  - CSV / TXT grids of numbers.
 *
 * Each decodes to a grid of heights; heightsToMap turns that into terrain.
 * Pure functions (no DOM), unit tested in tests/client/MapFileFormats.test.ts.
 */

import {
  blankMap,
  type EditableMap,
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";

export interface HeightGrid {
  width: number;
  height: number;
  heights: Float32Array;
  /**
   * Absolute sea level when the data is in metres (DEMs: 0). Undefined:
   * the editor's sea level slider decides.
   */
  seaLevel?: number;
  /** "No data" cells (become water). */
  noData?: number;
}

export class MapFileError extends Error {}

/** File extensions read as height data (lower case, no dot). */
export const HEIGHT_EXTENSIONS = [
  "tif",
  "tiff",
  "hgt",
  "asc",
  "pgm",
  "ppm",
  "pbm",
  "pnm",
  "raw",
  "r16",
  "r8",
  "csv",
  "txt",
] as const;

/** What the upload picker accepts. */
export const UPLOAD_ACCEPT = [
  "image/*",
  ".svg",
  ...HEIGHT_EXTENSIONS.map((e) => `.${e}`),
].join(",");

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** Height data in `bytes`, or null when the file is an ordinary image. */
export function decodeHeightFile(
  name: string,
  bytes: Uint8Array,
): HeightGrid | null {
  const ext = extensionOf(name);
  switch (ext) {
    case "tif":
    case "tiff":
      return decodeTiff(bytes);
    case "hgt":
      return decodeHgt(bytes);
    case "asc":
      return decodeAsciiGrid(text(bytes));
    case "pgm":
    case "ppm":
    case "pbm":
    case "pnm":
      return decodeNetpbm(bytes);
    case "raw":
    case "r16":
    case "r8":
      return decodeRaw(bytes, ext);
    case "csv":
    case "txt":
      return decodeNumberGrid(text(bytes));
    default:
      return null;
  }
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function grid(width: number, height: number): HeightGrid {
  if (width < 2 || height < 2) throw new MapFileError("The grid is too small");
  if (width * height > 64_000_000) {
    throw new MapFileError("The file is too big (over 64 million points)");
  }
  return { width, height, heights: new Float32Array(width * height) };
}

// ------------------------------------------------------------------ SRTM

export function decodeHgt(bytes: Uint8Array): HeightGrid {
  const side = Math.round(Math.sqrt(bytes.length / 2));
  if (side * side * 2 !== bytes.length) {
    throw new MapFileError("Not an SRTM .hgt tile (it must be square)");
  }
  const g = grid(side, side);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < side * side; i++) g.heights[i] = v.getInt16(i * 2, false);
  g.seaLevel = 0;
  g.noData = -32768;
  return g;
}

// ------------------------------------------------------------ ASCII grid

export function decodeAsciiGrid(src: string): HeightGrid {
  const tokens = src.split(/\s+/).filter((t) => t.length > 0);
  const header: Record<string, number> = {};
  let p = 0;
  while (p + 1 < tokens.length && /^[a-z_]+$/i.test(tokens[p])) {
    header[tokens[p].toLowerCase()] = Number(tokens[p + 1]);
    p += 2;
  }
  const w = header.ncols;
  const h = header.nrows;
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new MapFileError("Not an ESRI ASCII grid (ncols / nrows missing)");
  }
  const g = grid(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Number(tokens[p + i]);
    if (!Number.isFinite(v)) throw new MapFileError("The grid is cut short");
    g.heights[i] = v;
  }
  g.seaLevel = 0;
  if (header.nodata_value !== undefined) g.noData = header.nodata_value;
  return g;
}

// ---------------------------------------------------------- number grids

export function decodeNumberGrid(src: string): HeightGrid {
  const rows = src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(/[\s,;]+/).map(Number));
  const w = rows[0]?.length ?? 0;
  if (rows.some((r) => r.length !== w || r.some((v) => !Number.isFinite(v)))) {
    throw new MapFileError("Every line needs the same count of numbers");
  }
  const g = grid(w, rows.length);
  rows.forEach((r, y) => g.heights.set(r, y * w));
  let min = Infinity;
  for (const v of g.heights) min = Math.min(min, v);
  // Negative numbers: metres around sea level.
  if (min < 0) g.seaLevel = 0;
  return g;
}

// ---------------------------------------------------------------- Netpbm

export function decodeNetpbm(bytes: Uint8Array): HeightGrid {
  let p = 0;
  const token = (): string => {
    // Skip whitespace and # comments.
    for (;;) {
      while (p < bytes.length && /\s/.test(String.fromCharCode(bytes[p]))) p++;
      if (bytes[p] === 0x23) {
        while (p < bytes.length && bytes[p] !== 0x0a) p++;
      } else break;
    }
    let s = "";
    while (p < bytes.length && !/\s/.test(String.fromCharCode(bytes[p]))) {
      s += String.fromCharCode(bytes[p++]);
    }
    return s;
  };
  const magic = token();
  if (!/^P[1-6]$/.test(magic)) throw new MapFileError("Not a Netpbm file");
  const kind = Number(magic[1]);
  const w = Number(token());
  const h = Number(token());
  const max = kind === 1 || kind === 4 ? 1 : Number(token());
  const channels = kind === 3 || kind === 6 ? 3 : 1;
  const g = grid(w, h);
  if (kind <= 3) {
    for (let i = 0; i < w * h; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += Number(token());
      g.heights[i] = kind === 1 ? 1 - sum : sum / channels;
    }
  } else {
    p++; // single whitespace after the header
    if (kind === 4) {
      const rowBytes = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const bit = (bytes[p + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          g.heights[y * w + x] = 1 - bit;
        }
      }
    } else {
      const wide = max > 255;
      for (let i = 0; i < w * h; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          sum += wide ? (bytes[p] << 8) | bytes[p + 1] : bytes[p];
          p += wide ? 2 : 1;
        }
        g.heights[i] = sum / channels;
      }
    }
  }
  return g;
}

// ------------------------------------------------------------------- raw

export function decodeRaw(bytes: Uint8Array, ext: string): HeightGrid {
  const side16 = Math.round(Math.sqrt(bytes.length / 2));
  const side8 = Math.round(Math.sqrt(bytes.length));
  const is16 =
    ext === "r16" ||
    (ext !== "r8" &&
      side16 * side16 * 2 === bytes.length &&
      side8 * side8 !== bytes.length);
  if (is16) {
    if (side16 * side16 * 2 !== bytes.length) {
      throw new MapFileError("A 16-bit raw heightmap must be square");
    }
    const g = grid(side16, side16);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < side16 * side16; i++) {
      g.heights[i] = v.getUint16(i * 2, true);
    }
    return g;
  }
  if (side8 * side8 !== bytes.length) {
    throw new MapFileError("A raw heightmap must be square (8 or 16-bit)");
  }
  const g = grid(side8, side8);
  for (let i = 0; i < bytes.length; i++) g.heights[i] = bytes[i];
  return g;
}

// ------------------------------------------------------------------ TIFF

export function decodeTiff(bytes: Uint8Array): HeightGrid {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== "II" && order !== "MM") throw new MapFileError("Not a TIFF");
  const le = order === "II";
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  if (u16(2) !== 42) {
    throw new MapFileError("BigTIFF is not supported; save as a normal TIFF");
  }
  const ifd = u32(4);
  const n = u16(ifd);
  const tags = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = type === 3 ? 2 : type === 4 ? 4 : type === 1 ? 1 : 4;
    const inline = size * count <= 4;
    const at = inline ? e + 8 : u32(e + 8);
    const vals: number[] = [];
    for (let c = 0; c < Math.min(count, 1_000_000); c++) {
      const o = at + c * size;
      vals.push(type === 3 ? u16(o) : type === 1 ? bytes[o] : u32(o));
    }
    tags.set(tag, vals);
  }
  const one = (tag: number, def?: number): number => {
    const t = tags.get(tag)?.[0];
    if (t === undefined) {
      if (def === undefined) throw new MapFileError(`TIFF tag ${tag} missing`);
      return def;
    }
    return t;
  };
  const w = one(256);
  const h = one(257);
  const bits = one(258, 1);
  const compression = one(259, 1);
  const spp = one(277, 1);
  const format = one(339, 1); // 1 uint, 2 int, 3 float
  if (compression !== 1) {
    throw new MapFileError(
      "Compressed TIFFs are not supported; export it uncompressed or as PNG",
    );
  }
  if (tags.has(322)) {
    throw new MapFileError("Tiled TIFFs are not supported; export with strips");
  }
  const offsets = tags.get(273) ?? [];
  const rowsPerStrip = one(278, h);
  const bytesPer = bits / 8;
  if (![1, 2, 4].includes(bytesPer)) {
    throw new MapFileError(`${bits}-bit TIFFs are not supported`);
  }
  const g = grid(w, h);
  const rowBytes = w * spp * bytesPer;
  for (let y = 0; y < h; y++) {
    const strip = Math.floor(y / rowsPerStrip);
    const base = offsets[strip] + (y - strip * rowsPerStrip) * rowBytes;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const channels = Math.min(spp, 3);
      for (let c = 0; c < channels; c++) {
        const o = base + (x * spp + c) * bytesPer;
        let val: number;
        if (bytesPer === 1) val = format === 2 ? v.getInt8(o) : bytes[o];
        else if (bytesPer === 2) {
          val = format === 2 ? v.getInt16(o, le) : v.getUint16(o, le);
        } else {
          val =
            format === 3
              ? v.getFloat32(o, le)
              : format === 2
                ? v.getInt32(o, le)
                : v.getUint32(o, le);
        }
        sum += val;
      }
      g.heights[y * w + x] = sum / channels;
    }
  }
  // Signed or float data is almost always metres (a DEM).
  if (format === 2 || format === 3) {
    g.seaLevel = 0;
    // GDAL's no-data tag.
    const nd = tags.get(42113);
    if (nd) {
      const s = String.fromCharCode(...nd).replace(/\0/g, "");
      if (s.trim() !== "") g.noData = Number(s);
    } else g.noData = -32768;
  }
  return g;
}

// ------------------------------------------------------------ to terrain

/**
 * Heights → terrain at `width` × `height` (bilinear resampling). Water is
 * at or below the sea level: the file's own (metres) or, without one, the
 * `seaSlider` (0-255) share of the height range. Land heights are spread
 * over elevations 0-30 with a gentle curve, so plains stay plains and
 * only the highest ground becomes mountains.
 */
export function heightsToMap(
  g: HeightGrid,
  width: number,
  height: number,
  seaSlider = 60,
): EditableMap {
  const m = blankMap(width, height);
  const { heights } = g;
  const valid = (v: number) =>
    Number.isFinite(v) &&
    v !== g.noData &&
    v > -1e30 &&
    !(g.noData === undefined && v < -1e6);
  let min = Infinity;
  let max = -Infinity;
  for (const v of heights) {
    if (!valid(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) throw new MapFileError("The file has no heights");
  const sea = g.seaLevel ?? min + ((max - min) * seaSlider) / 255;
  // Top of the land range: 99.5th percentile, so a single spike doesn't
  // flatten everything else.
  const landVals: number[] = [];
  const step = Math.max(1, Math.floor(heights.length / 50000));
  for (let i = 0; i < heights.length; i += step) {
    const v = heights[i];
    if (valid(v) && v > sea) landVals.push(v);
  }
  landVals.sort((a, b) => a - b);
  const top = landVals.length
    ? landVals[Math.floor((landVals.length - 1) * 0.995)]
    : sea + 1;
  const span = Math.max(1e-6, top - sea);
  const sx = (g.width - 1) / Math.max(1, width - 1);
  const sy = (g.height - 1) / Math.max(1, height - 1);
  for (let y = 0; y < m.height; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const y1 = Math.min(g.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < m.width; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(g.width - 1, x0 + 1);
      const tx = fx - x0;
      const a = heights[y0 * g.width + x0];
      const b = heights[y0 * g.width + x1];
      const c = heights[y1 * g.width + x0];
      const d = heights[y1 * g.width + x1];
      const i = y * m.width + x;
      if (!valid(a) || !valid(b) || !valid(c) || !valid(d)) {
        m.kind[i] = TERRAIN_WATER;
        continue;
      }
      const v =
        a * (1 - tx) * (1 - ty) +
        b * tx * (1 - ty) +
        c * (1 - tx) * ty +
        d * tx * ty;
      if (v <= sea) continue;
      m.kind[i] = TERRAIN_LAND;
      const t = Math.min(1, (v - sea) / span);
      m.elevation[i] = Math.min(30, Math.round(Math.pow(t, 0.85) * 30));
    }
  }
  return m;
}
