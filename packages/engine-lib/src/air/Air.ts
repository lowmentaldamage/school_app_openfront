/**
 * Air war (WW2 style). Airbases launch bomber raids (the "airstrike" weapon:
 * pick a target, a bomber flies there, drops a stick of bombs and flies
 * home) and scramble fighters against enemy bombers nearby. SAM launchers
 * and Rail SAMs damage bombers flying through their range.
 * Shared by the engine and the client. Integer maths.
 */

export const AIRBASE = {
  baseCost: 300_000,
  maxCost: 1_500_000,
} as const;

export const BOMBER = {
  /** Tiles per tick. */
  speed: 2,
  maxHealth: 300,
} as const;

export const FIGHTER = {
  speed: 4,
  /** Airbases scramble a fighter at enemy bombers within this range. */
  interceptRange: 70,
  /** Damage of one fighter pass (a bomber has 300 health). */
  damage: 160,
  /** Ticks between scrambles from one airbase. */
  reloadTicks: 60,
  /** A fighter gives up and returns after this many ticks. */
  maxFlightTicks: 120,
} as const;

/** Anti-air fire on bombers from enemy SAM launchers and Rail SAMs. */
export const ANTI_AIR = {
  range: 30,
  /** Damage per SAM per volley. */
  damage: 50,
  volleyTicks: 5,
} as const;
