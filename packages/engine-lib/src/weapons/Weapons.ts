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
  WEAPON_IDS,
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

// ---------------------------------------------------------------------------
// Power tiers: every weapon can be upgraded Mk I → Mk II → Mk III with gold.
// A player's tiers are packed into one integer (2 bits per weapon, in
// WEAPON_IDS order), like the tech mask, so they travel cheaply.
// ---------------------------------------------------------------------------

export type WeaponTier = 1 | 2 | 3;
export const MAX_WEAPON_TIER: WeaponTier = 3;

/** Gold to reach Mk II and Mk III. */
export const WEAPON_UPGRADE_COST: Readonly<
  Record<WeaponId, readonly [bigint, bigint]>
> = {
  artillery: [250_000n, 700_000n],
  naval: [250_000n, 700_000n],
  airstrike: [400_000n, 1_000_000n],
  rocket: [500_000n, 1_200_000n],
};

function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}

/** Tier of `id` in a packed tiers value (0 bits = Mk I). */
export function weaponTier(packed: number, id: WeaponId): WeaponTier {
  const v = (packed >>> (weaponIndex(id) * 2)) & 3;
  return (v + 1 > 3 ? 3 : v + 1) as WeaponTier;
}

/** `packed` with `id` set to `tier`. */
export function withWeaponTier(
  packed: number,
  id: WeaponId,
  tier: WeaponTier,
): number {
  const shift = weaponIndex(id) * 2;
  return (packed & ~(3 << shift)) | ((tier - 1) << shift);
}

/** Gold for the next tier of `id`, or null at Mk III. */
export function weaponUpgradeCost(packed: number, id: WeaponId): bigint | null {
  const t = weaponTier(packed, id);
  if (t >= MAX_WEAPON_TIER) return null;
  return WEAPON_UPGRADE_COST[id][t - 1];
}

export type WeaponUpgradeBlock = "max" | "gold" | "dead" | null;

/**
 * Why `id` cannot be upgraded now, or null if it can. `price` maps the
 * list price to what this player pays (Config.strikeCost: free with
 * infinite gold).
 */
export function weaponUpgradeBlock(
  packed: number,
  id: WeaponId,
  gold: bigint,
  alive: boolean,
  price: (cost: bigint) => bigint = (c) => c,
): WeaponUpgradeBlock {
  if (!alive) return "dead";
  const cost = weaponUpgradeCost(packed, id);
  if (cost === null) return "max";
  if (gold < price(cost)) return "gold";
  return null;
}

/**
 * The weapon at a tier. Each tier above Mk I adds a shot (rockets: a
 * bigger blast instead), a tile of blast radius, +40% troop losses, +50%
 * ship damage and +20% range. Mk III shells and bombs also wreck
 * buildings, and Mk III bombs and rockets knock them down two levels.
 */
export function weaponAtTier(spec: WeaponSpec, tier: WeaponTier): WeaponSpec {
  if (tier <= 1) return spec;
  const up = tier - 1;
  const pct = (v: number, perTier: number) =>
    Math.floor((v * (100 + perTier * up)) / 100);
  return {
    ...spec,
    shots: spec.id === "rocket" ? spec.shots : spec.shots + up,
    radius: spec.radius + up + (spec.id === "rocket" ? up : 0),
    range: pct(spec.range, 20),
    lossPerMille: pct(spec.lossPerMille, 40),
    troopsPerTile: pct(spec.troopsPerTile, 40),
    warshipDamage: pct(spec.warshipDamage, 50),
    damagesStructures: spec.damagesStructures || tier >= 3,
  };
}

/** Building levels one impact knocks off (0 when it spares buildings). */
export function structureLevelsLost(
  spec: WeaponSpec,
  tier: WeaponTier,
): number {
  const s = weaponAtTier(spec, tier);
  if (!s.damagesStructures) return 0;
  return tier >= 3 && (spec.id === "airstrike" || spec.id === "rocket") ? 2 : 1;
}

/** A player's weapon at its current tier (anything with weaponTiers()). */
export function playerWeapon(
  player: { weaponTiers?(): number },
  id: WeaponId,
): WeaponSpec {
  return weaponAtTier(WEAPONS[id], weaponTier(player.weaponTiers?.() ?? 0, id));
}

// ---------------------------------------------------------------------------
// Terrain and line of fire. Shells and rockets cannot pass through a
// mountain range that stands higher than both ends of the shot; bombers fly
// over everything. Guns on high ground see and shoot further.
// ---------------------------------------------------------------------------

/** The map queries the terrain rules need (GameMap has them all). */
export interface FireTerrain {
  x(ref: number): number;
  y(ref: number): number;
  ref(x: number, y: number): number;
  isLand(ref: number): boolean;
  /** Terrain magnitude 0-30 (mountains from 20). */
  magnitude(ref: number): number;
}

/** Terrain magnitude from which land is mountain. */
export const MOUNTAIN_MAGNITUDE = 20;
/** Magnitude from which land is highland. */
export const HIGHLAND_MAGNITUDE = 10;
/** A ridge must stand this much higher than both ends to block. */
export const RIDGE_MARGIN = 4;
/** Ridge tiles on the line needed to block (a lone peak does not). */
export const RIDGE_TILES_TO_BLOCK = 2;
/** Tiles at each end that never block (the launcher's and target's hill). */
const END_SKIP = 2;

function elevation(map: FireTerrain, t: number): number {
  return map.isLand(t) ? map.magnitude(t) : 0;
}

/**
 * True when a mountain range between `from` and `to` blocks the shot.
 * Air raids are never blocked. Integer grid walk; deterministic.
 */
export function lineOfFireBlocked(
  map: FireTerrain,
  from: number,
  to: number,
  weapon: WeaponId,
): boolean {
  if (weapon === "airstrike") return false;
  const ends = Math.max(elevation(map, from), elevation(map, to));
  const threshold = Math.max(MOUNTAIN_MAGNITUDE, ends + RIDGE_MARGIN);
  let x = map.x(from);
  let y = map.y(from);
  const x1 = map.x(to);
  const y1 = map.y(to);
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  const total = Math.max(dx, -dy);
  let err = dx + dy;
  let ridge = 0;
  for (let step = 0; ; step++) {
    if (step > END_SKIP && step < total - END_SKIP) {
      if (elevation(map, map.ref(x, y)) >= threshold) {
        ridge++;
        if (ridge >= RIDGE_TILES_TO_BLOCK) return true;
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

/**
 * Range of a launcher standing on `tile`: +20% on mountains, +10% on
 * highland (high ground). Ships and planes: unchanged.
 */
export function launcherRange(
  map: FireTerrain,
  spec: WeaponSpec,
  tile: number,
): number {
  if (spec.id === "airstrike" || !map.isLand(tile)) return spec.range;
  const m = map.magnitude(tile);
  if (m >= MOUNTAIN_MAGNITUDE) return Math.floor((spec.range * 120) / 100);
  if (m >= HIGHLAND_MAGNITUDE) return Math.floor((spec.range * 110) / 100);
  return spec.range;
}
