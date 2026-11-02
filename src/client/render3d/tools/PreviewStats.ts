/**
 * Image statistics for the all-maps 3D check: catches blank, black or
 * broken renders. `summarisePixels` is pure (unit tested); `analysePreview`
 * reads a rendered canvas.
 */

import { isLandByte } from "../terrain/TerrainCodec";

export interface PreviewStats {
  /** Mean luminance 0..255. */
  meanLuma: number;
  /** Luminance standard deviation (≈0 for a blank image). */
  lumaStdDev: number;
  /** Share of pure-black pixels (shader failures render black). */
  blackShare: number;
  /** Share of greenish / earthy pixels (land rendered). */
  landColourShare: number;
  /** Share of land tiles in the map data. */
  mapLandShare: number;
  /** Problems found; empty when the render looks healthy. */
  problems: string[];
}

export function summarisePixels(
  rgba: Uint8ClampedArray | Uint8Array,
  mapLandShare: number,
): PreviewStats {
  const n = rgba.length / 4;
  let sum = 0;
  let sum2 = 0;
  let black = 0;
  let landish = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    sum2 += l * l;
    if (r < 6 && g < 6 && b < 6) black++;
    // Land reads green/brown/grey-rock/snow; water reads blue-dominant.
    if (!(b > r + 12 && b >= g - 4)) landish++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const stats: PreviewStats = {
    meanLuma: Math.round(mean),
    lumaStdDev: Math.round(std),
    blackShare: black / n,
    landColourShare: landish / n,
    mapLandShare,
    problems: [],
  };
  if (std < 6) stats.problems.push("blank image");
  if (stats.blackShare > 0.05) stats.problems.push("black pixels (shader?)");
  if (mean < 25) stats.problems.push("too dark");
  if (mean > 235) stats.problems.push("washed out");
  if (mapLandShare > 0.05 && stats.landColourShare < 0.01) {
    stats.problems.push("no land visible");
  }
  return stats;
}

export function analysePreview(
  canvas: HTMLCanvasElement,
  terrain: Uint8Array,
): PreviewStats {
  const c2 = document.createElement("canvas");
  c2.width = canvas.width;
  c2.height = canvas.height;
  const ctx = c2.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable");
  ctx.drawImage(canvas, 0, 0);
  const px = ctx.getImageData(0, 0, c2.width, c2.height).data;
  let land = 0;
  for (let i = 0; i < terrain.length; i++) if (isLandByte(terrain[i])) land++;
  return summarisePixels(px, land / Math.max(1, terrain.length));
}
