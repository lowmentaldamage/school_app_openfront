/**
 * Income buildings — more ways to earn gold than workers, trade and trains.
 * Shared by the engine (rules) and the client (menus). Integer maths.
 *
 *  - Gold Mine: on your highland or mountain land. Steady gold; mountains
 *    are worth holding.
 *  - Market: on any of your land. Smaller income, cheap.
 *  - Oil Rig: offshore, on water within OIL_RIG_RANGE tiles of your coast.
 *    The biggest income, but exposed to warships and bombers.
 *
 * Income is paid every INCOME_INTERVAL_TICKS: perTick × level × interval.
 * For scale, every player's workers earn 100 gold per tick.
 */

import {
  EconomyBuildings,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";

export type EconomyBuildingType = (typeof EconomyBuildings.types)[number];

export interface EconomySpec {
  /** Gold per tick per building level. */
  perTick: number;
  /** Cost of the n-th building (n from 0): base × (n+1), capped. */
  baseCost: number;
  maxCost: number;
}

export const ECONOMY_BUILDINGS: Readonly<
  Record<EconomyBuildingType, EconomySpec>
> = {
  [UnitType.GoldMine]: { perTick: 40, baseCost: 200_000, maxCost: 1_500_000 },
  [UnitType.Market]: { perTick: 25, baseCost: 120_000, maxCost: 1_000_000 },
  [UnitType.OilRig]: { perTick: 70, baseCost: 350_000, maxCost: 2_000_000 },
};

export const INCOME_INTERVAL_TICKS = 10;

/** Oil rigs stand on water at most this far (tiles) from their owner's land. */
export const OIL_RIG_RANGE = 8;

export function isEconomyBuilding(t: UnitType): t is EconomyBuildingType {
  return EconomyBuildings.has(t);
}

export function economyCost(spec: EconomySpec, owned: number): number {
  return Math.min(spec.maxCost, spec.baseCost * (owned + 1));
}

/** Gold paid per income interval for a building at `level`. */
export function incomePerInterval(spec: EconomySpec, level: number): bigint {
  return BigInt(spec.perTick * Math.max(1, level) * INCOME_INTERVAL_TICKS);
}
