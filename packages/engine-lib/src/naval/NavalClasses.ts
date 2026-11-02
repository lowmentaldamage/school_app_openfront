/**
 * Naval classes — the numbers that make a Destroyer or a Battleship differ
 * from the classic Warship. All three share the warship behaviour
 * (patrol, fight, sink transports, hunt trade ships, repair at ports, obey
 * move orders); see engine/execution/WarshipExecution.ts.
 *
 * Shared by the engine (rules) and the client (build menu text, health
 * bars), so both always agree. Integer maths only; deterministic.
 */

import { CombatShips, UnitType } from "@laukolaroser/engine-api/game/GameTypes";

export type CombatShipType = (typeof CombatShips.types)[number];

export interface NavalClassSpec {
  /** Path steps per 6 ticks (the Warship takes 6, i.e. one per tick). */
  stepsPer6Ticks: number;
  /** Max health. */
  maxHealth: number;
  /** Targeting range, percent of the warship range. */
  rangePercent: number;
  /** Reload time, percent of the warship reload. */
  reloadPercent: number;
  /** Shell damage, percent of the warship shell. */
  damagePercent: number;
  /**
   * Coastal bombardment: while its owner is fighting a land war, the ship
   * shells that enemy's land within range on its own (no gold cost; it
   * uses the naval weapon's impact rules). Null = never.
   */
  bombard: { range: number; reloadTicks: number } | null;
}

export const NAVAL_CLASSES: Readonly<Record<CombatShipType, NavalClassSpec>> = {
  [UnitType.Warship]: {
    stepsPer6Ticks: 6,
    maxHealth: 1000,
    rangePercent: 100,
    reloadPercent: 100,
    damagePercent: 100,
    bombard: null,
  },
  // Cheap fast escort: outruns everything, light guns, quick reload.
  [UnitType.Destroyer]: {
    stepsPer6Ticks: 10,
    maxHealth: 450,
    rangePercent: 85,
    reloadPercent: 50,
    damagePercent: 45,
    bombard: null,
  },
  // Siege ship: slow, very tough, heavy long-range guns, shells the coast.
  [UnitType.Battleship]: {
    stepsPer6Ticks: 4,
    maxHealth: 3500,
    rangePercent: 140,
    reloadPercent: 160,
    damagePercent: 220,
    bombard: { range: 40, reloadTicks: 9 * 10 },
  },
};

export function isCombatShip(type: UnitType): type is CombatShipType {
  return CombatShips.has(type);
}

export function navalClass(type: UnitType): NavalClassSpec {
  return isCombatShip(type)
    ? NAVAL_CLASSES[type]
    : NAVAL_CLASSES[UnitType.Warship];
}

/** Path steps a ship of this class takes on `tick` (0, 1 or 2). */
export function navalStepsOnTick(spec: NavalClassSpec, tick: number): number {
  if (spec.stepsPer6Ticks === 6) return 1;
  const t = Math.max(0, Math.floor(tick));
  return (
    Math.floor((t * spec.stepsPer6Ticks) / 6) -
    Math.floor((Math.max(0, t - 1) * spec.stepsPer6Ticks) / 6)
  );
}

/** Scale an integer by a percentage, rounding down (at least 1). */
export function scalePercent(value: number, percent: number): number {
  return Math.max(1, Math.floor((value * percent) / 100));
}
