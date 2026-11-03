/**
 * Radar Station — a structure that watches a wide circle around it.
 *
 * Engine: inside the circle, the owner's (and allies') warships can target
 * enemy submarines at full range, not only within SUBMARINE_DETECT_RANGE.
 * Client: with fog of war on, it reveals enemy units and buildings in the
 * circle. Shared by both, so they always agree. Integer maths.
 */

export const RADAR = {
  baseCost: 150_000,
  maxCost: 1_000_000,
  /** Radius in tiles at level 1. */
  range: 90,
  /** Extra radius per upgrade level. */
  rangePerLevel: 20,
  /** Upper bound of any radar radius (for spatial queries). */
  maxRange: 90 + 20 * 9,
} as const;

/** Radius (tiles) of a radar station of `level` (1-based). */
export function radarRange(level: number): number {
  const lvl = Math.max(1, Math.min(10, Math.floor(level)));
  return RADAR.range + RADAR.rangePerLevel * (lvl - 1);
}

/** Radar build cost for the owner's `numUnits`-th radar (0-based). */
export function radarCost(numUnits: number): number {
  return Math.min(RADAR.maxCost, RADAR.baseCost * (numUnits + 1));
}
