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
  width: number;
  height: number;
  /** Interleaved [height, land] per tile, row-major. */
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
  return { width, height, values };
}
