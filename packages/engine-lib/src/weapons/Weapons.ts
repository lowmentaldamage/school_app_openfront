/**
 * Weapons — aim-and-fire strikes launched from existing military units.
 *
 * Shared by the engine (rules) and the client (UI: range, cost, readiness),
 * so both sides always agree. Pure data and integer maths; deterministic.
 *
 * Strikes fit the strategic style of the game: they never take territory
 * (ground attacks still win land); they bleed the target nation's troops in
 * proportion to how much of its land they hit, sink or damage ships, and
 * rockets knock buildings down a level.
 */

import {
  UnitType,
  type WeaponId,
} from "@laukolaroser/engine-api/game/GameTypes";

export {
  WEAPON_IDS,
  type WeaponId,
} from "@laukolaroser/engine-api/game/GameTypes";

export interface WeaponSpec {
  id: WeaponId;
  /** Units that fire it; the nearest ready one in range is used. */
  launchers: readonly UnitType[];
  /** Projectile unit flown to the target. */
  projectile: UnitType.ArtilleryShell | UnitType.Rocket;
  /** Max launcher → target distance, tiles. */
  range: number;
  /** Gold per strike. */
  cost: bigint;
  /** Projectiles per strike. */
  shots: number;
  /** Ticks between consecutive shots of one strike. */
  shotInterval: number;
  /** Shots land within this many tiles of the aim point. */
  spread: number;
  /** Impact radius, tiles. */
  radius: number;
  /** Tiles per tick the projectile flies. */
  speed: number;
  /**
   * Troop losses per impact = targetTroops × tilesHit × lossPerMille
   *   ÷ (targetTiles × 1000), plus `troopsPerTile` per tile hit.
   */
  lossPerMille: number;
  troopsPerTile: number;
  /** Health removed from enemy warships in the blast. */
  warshipDamage: number;
  /** Rockets knock the nearest enemy building in the blast down a level. */
  damagesStructures: boolean;
  /**
   * Launcher reload in ticks. Missile silos reuse their own silo reload
   * (a rocket uses a silo slot, like a nuke), so this is ignored for them.
   */
  cooldownTicks: number;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = {
  artillery: {
    id: "artillery",
    launchers: [UnitType.DefensePost],
    projectile: UnitType.ArtilleryShell,
    range: 45,
    cost: 40_000n,
    shots: 3,
    shotInterval: 4,
    spread: 3,
    radius: 3,
    speed: 4,
    lossPerMille: 1_500,
    troopsPerTile: 6,
    warshipDamage: 200,
    damagesStructures: false,
    cooldownTicks: 15 * 10,
  },
  naval: {
    id: "naval",
    launchers: [UnitType.Warship, UnitType.Destroyer, UnitType.Battleship],
    projectile: UnitType.ArtilleryShell,
    range: 35,
    cost: 30_000n,
    shots: 2,
    shotInterval: 5,
    spread: 2,
    radius: 3,
    speed: 4,
    lossPerMille: 1_200,
    troopsPerTile: 5,
    warshipDamage: 250,
    damagesStructures: false,
    cooldownTicks: 12 * 10,
  },
  // Bomber raid from an Airbase: the bomber flies to the target and drops
  // `shots` bombs (each an impact with these rules); see BomberExecution.
  airstrike: {
    id: "airstrike",
    launchers: [UnitType.Airbase, UnitType.Carrier],
    projectile: UnitType.ArtilleryShell,
    range: 320,
    cost: 100_000n,
    shots: 4,
    shotInterval: 3,
    spread: 4,
    radius: 3,
    speed: 3,
    lossPerMille: 1_400,
    troopsPerTile: 7,
    warshipDamage: 300,
    damagesStructures: true,
    cooldownTicks: 30 * 10,
  },
  rocket: {
    id: "rocket",
    launchers: [UnitType.MissileSilo],
    projectile: UnitType.Rocket,
    range: 220,
    cost: 150_000n,
    shots: 1,
    shotInterval: 0,
    spread: 0,
    radius: 5,
    speed: 6,
    lossPerMille: 3_000,
    troopsPerTile: 12,
    warshipDamage: 600,
    damagesStructures: true,
    cooldownTicks: 0,
  },
};

/**
 * Troops a single impact kills. Integer maths (deterministic); never more
 * than the target has.
 */
export function strikeTroopLoss(
  spec: WeaponSpec,
  targetTroops: number,
  targetTiles: number,
  tilesHit: number,
): number {
  if (tilesHit <= 0 || targetTroops <= 0) return 0;
  const proportional = Math.floor(
    (targetTroops * tilesHit * spec.lossPerMille) /
      (Math.max(1, targetTiles) * 1000),
  );
  return Math.min(targetTroops, proportional + tilesHit * spec.troopsPerTile);
}
