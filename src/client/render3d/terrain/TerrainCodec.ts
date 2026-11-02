/**
 * Decodes the per-tile terrain byte produced by `GameMap.terrainByte()`.
 *
 * Bit layout (mirrors packages/engine-lib/src/game/GameMapImpl.ts):
 *   bit 7     land
 *   bit 6     shoreline
 *   bit 5     ocean
 *   bits 0-4  magnitude (land: elevation class, water: distance to land)
 *
 * Land magnitude 31 marks impassable terrain. Lake water is encoded as 0.
 * The 3D renderer only reads these bits; it never writes terrain.
 */

export const LAND_BIT = 1 << 7;
export const SHORELINE_BIT = 1 << 6;
export const OCEAN_BIT = 1 << 5;
export const MAGNITUDE_MASK = 0x1f;
export const IMPASSABLE_MAGNITUDE = 31;

/** Elevation classes, matching GameMapImpl.terrainType thresholds. */
export const enum Biome {
  Ocean = 0,
  Lake = 1,
  Plains = 2,
  Highland = 3,
  Mountain = 4,
  Impassable = 5,
}

export function isLandByte(b: number): boolean {
  return (b & LAND_BIT) !== 0;
}

export function magnitudeOf(b: number): number {
  return b & MAGNITUDE_MASK;
}

export function biomeOf(b: number): Biome {
  if ((b & LAND_BIT) === 0) {
    return (b & OCEAN_BIT) !== 0 ? Biome.Ocean : Biome.Lake;
  }
  const m = b & MAGNITUDE_MASK;
  if (m >= IMPASSABLE_MAGNITUDE) return Biome.Impassable;
  if (m < 10) return Biome.Plains;
  if (m < 20) return Biome.Highland;
  return Biome.Mountain;
}
