/**
 * Defense extras — numbers shared by the engine (rules) and the client
 * (build menu help), so both always agree. Integer maths only.
 *
 *  - Fort: a short-range stronghold. Enemy land attacks on tiles within
 *    FORT.range lose FORT.lossFactor× more troops and move FORT.speedFactor×
 *    slower (stacks with a defense post).
 *  - Coastal Battery: a shore gun that shells enemy warships, spotted
 *    submarines and transports within range.
 *  - Sea Mine: hidden from enemies; blows up the first enemy ship that comes
 *    within triggerRange. Destroyers sweep mines safely.
 */

export const FORT = {
  baseCost: 250_000,
  maxCost: 1_500_000,
  range: 10,
  lossFactor: 3,
  speedFactor: 2,
} as const;

export const COASTAL_BATTERY = {
  baseCost: 300_000,
  maxCost: 1_500_000,
  /** Tiles. */
  range: 45,
  /** Ticks between shots (per level, the reload shortens). */
  reloadTicks: 25,
  maxHealth: 2000,
} as const;

export const SEA_MINE = {
  baseCost: 30_000,
  maxCost: 300_000,
  /** An enemy ship this close (tiles) sets it off. */
  triggerRange: 2,
  /** Damage to the ship that hits it (a warship has 1000 health). */
  damage: 700,
  /** Mines may be laid this far (tiles) from the owner's land. */
  layRange: 25,
  /** Minimum distance between two mines (tiles). */
  spacing: 2,
  /** Check for ships every this many ticks. */
  checkTicks: 2,
} as const;

/** Battery reload at `level` (1-based): 10% faster per level, min half. */
export function batteryReload(level: number): number {
  const lvl = Math.max(1, Math.min(6, Math.floor(level)));
  return Math.max(
    Math.floor(COASTAL_BATTERY.reloadTicks / 2),
    Math.floor((COASTAL_BATTERY.reloadTicks * (11 - lvl)) / 10),
  );
}

export function scaledCost(
  spec: { baseCost: number; maxCost: number },
  numUnits: number,
): number {
  return Math.min(spec.maxCost, spec.baseCost * (numUnits + 1));
}
