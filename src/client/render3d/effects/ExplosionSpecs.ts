/**
 * Which explosion a simulation event produces. Pure (no three.js) and unit
 * tested. Effects are cosmetic: they read events, never game state.
 */

export type ExplosionKind =
  | "nuke"
  | "airburst"
  | "ship"
  | "building"
  | "shellHit"
  | "small";

export interface ExplosionSpec {
  kind: ExplosionKind;
  /** Visual radius in tiles (fireball / shockwave reach). */
  radius: number;
  /** Altitude of the blast above the surface, tiles. */
  altitude: number;
  /** Particle budget multiplier (1 = normal). */
  intensity: number;
}

const NUKE_RADIUS: Record<string, number> = {
  "Atom Bomb": 12,
  "Hydrogen Bomb": 30,
  "MIRV Warhead": 9,
};

const STRUCTURES = new Set([
  "City",
  "Port",
  "Factory",
  "Defense Post",
  "SAM Launcher",
  "Missile Silo",
]);

const SHIPS = new Set([
  "Warship",
  "Destroyer",
  "Battleship",
  "Transport",
  "Trade Ship",
]);

/**
 * @param unitType the dead unit's type string
 * @param reachedTarget true when it arrived (impact / docking), false when
 *   it was destroyed or intercepted
 */
export function explosionFor(
  unitType: string,
  reachedTarget: boolean,
): ExplosionSpec | null {
  const nukeRadius = NUKE_RADIUS[unitType];
  if (nukeRadius !== undefined) {
    return reachedTarget
      ? {
          kind: "nuke",
          radius: nukeRadius,
          altitude: 0,
          intensity: nukeRadius / 12,
        }
      : { kind: "airburst", radius: 4, altitude: 12, intensity: 0.8 };
  }
  if (unitType === "MIRV") {
    // The carrier splits into warheads; it does not detonate itself.
    return reachedTarget
      ? null
      : { kind: "airburst", radius: 5, altitude: 14, intensity: 1 };
  }
  if (unitType === "SAMMissile") {
    return { kind: "airburst", radius: 2, altitude: 10, intensity: 0.5 };
  }
  if (unitType === "Artillery Shell") {
    return reachedTarget
      ? { kind: "shellHit", radius: 3, altitude: 0, intensity: 0.8 }
      : null;
  }
  if (unitType === "Rocket") {
    return reachedTarget
      ? { kind: "building", radius: 5, altitude: 0, intensity: 1.2 }
      : null;
  }
  if (unitType === "Shell") {
    return reachedTarget
      ? { kind: "shellHit", radius: 1.2, altitude: 0, intensity: 0.4 }
      : null;
  }
  if (SHIPS.has(unitType)) {
    // Ships that dock or unload simply vanish; sunk ships explode.
    return reachedTarget
      ? null
      : { kind: "ship", radius: 3, altitude: 0, intensity: 1 };
  }
  if (STRUCTURES.has(unitType)) {
    return { kind: "building", radius: 3.5, altitude: 0, intensity: 1 };
  }
  if (unitType === "Train") {
    return reachedTarget
      ? null
      : { kind: "small", radius: 1.5, altitude: 0, intensity: 0.5 };
  }
  return null;
}
