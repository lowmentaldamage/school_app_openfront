/**
 * Military trains — buildable units that patrol their owner's rail network
 * between the owner's own stations (cities, ports, factories). Shared by
 * the engine (rules) and the client (menus, health bars). Integer maths.
 *
 *  - Armored Train: shells enemy land next to the tracks while its owner
 *    fights a land war (artillery impact rules, no gold cost).
 *  - Troop Train: delivers reinforcements at each of its owner's cities.
 *  - Rail SAM: mobile air defence, shoots down enemy nukes flying nearby.
 *
 * Express cargo trains are not built: stations of a nation with a level 2+
 * factory sometimes send faster, richer trade trains on their own (see
 * engine/execution/TrainStationExecution.ts).
 */

import { RailUnits, UnitType } from "@laukolaroser/engine-api/game/GameTypes";

export type RailUnitType = (typeof RailUnits.types)[number];

export interface RailUnitSpec {
  /** Rail tiles per tick. */
  speed: number;
  maxHealth: number;
  /** Cost of the n-th unit (n from 0): base × (n+1), capped. */
  baseCost: number;
  maxCost: number;
}

export const RAIL_UNITS: Readonly<Record<RailUnitType, RailUnitSpec>> = {
  [UnitType.ArmoredTrain]: {
    speed: 1,
    maxHealth: 800,
    baseCost: 300_000,
    maxCost: 1_200_000,
  },
  [UnitType.TroopTrain]: {
    speed: 2,
    maxHealth: 250,
    baseCost: 120_000,
    maxCost: 600_000,
  },
  [UnitType.RailSAM]: {
    speed: 1,
    maxHealth: 400,
    baseCost: 250_000,
    maxCost: 1_000_000,
  },
};

/** Armored train guns. */
export const ARMORED_TRAIN = {
  /** Tiles from the train to the land it shells. */
  range: 16,
  /** Ticks between salvos. */
  reloadTicks: 60,
  shots: 2,
} as const;

/** Troop train deliveries. */
export const TROOP_TRAIN = {
  /** Reinforcements per city stop, per mille of the owner's max troops. */
  perMilleOfMaxTroops: 6,
  /** Extra per mille for each city level above 1. */
  perMillePerCityLevel: 2,
} as const;

/** Rail SAM interceptors. */
export const RAIL_SAM = {
  /** Tiles from the train to the nuke. */
  range: 40,
  reloadTicks: 70,
} as const;

/** Express cargo trains (sent by stations, not built). */
export const EXPRESS_TRAIN = {
  /** Rail tiles per tick (normal trade trains: 2). */
  speed: 3,
  cars: 3,
  /** Gold per stop, percent of a normal train's. */
  goldPercent: 160,
  /** A station sends express trains once its owner has a factory this level. */
  minFactoryLevel: 2,
  /** One in this many trains from such a station is an express. */
  oneIn: 3,
} as const;

/** Max distance from the clicked tile to the station the train starts at. */
export const RAIL_UNIT_SPAWN_RADIUS = 40;

export function isRailUnit(type: UnitType): type is RailUnitType {
  return RailUnits.has(type);
}

export function railUnitCost(spec: RailUnitSpec, owned: number): number {
  return Math.min(spec.maxCost, spec.baseCost * (owned + 1));
}
