/**
 * Tech tree — research with gold and time, one project at a time.
 *
 * Four branches (Army, Navy, Air, Economy), three tiers each; Air and Navy
 * have two lines of three. A tier needs the tier before it in its line. Researched techs
 * are a bitmask on the player (bit = TECHS index), so they travel cheaply
 * to the client. Shared by the engine (rules) and the client (panel), so
 * both always agree. Integer maths only; deterministic.
 */

import { TECH_IDS, type TechId } from "@laukolaroser/engine-api/game/GameTypes";

export { TECH_IDS, type TechId };

export type TechBranch = "army" | "navy" | "air" | "economy";

export interface TechSpec {
  id: TechId;
  branch: TechBranch;
  tier: 1 | 2 | 3;
  cost: bigint;
  /** Research time in ticks (10 per second). */
  ticks: number;
  requires: TechId | null;
}

const TIER_COST: Record<1 | 2 | 3, bigint> = {
  1: 150_000n,
  2: 400_000n,
  3: 900_000n,
};
const TIER_TICKS: Record<1 | 2 | 3, number> = { 1: 300, 2: 600, 3: 900 };

function spec(
  id: TechId,
  branch: TechBranch,
  tier: 1 | 2 | 3,
  requires: TechId | null,
): TechSpec {
  return {
    id,
    branch,
    tier,
    cost: TIER_COST[tier],
    ticks: TIER_TICKS[tier],
    requires,
  };
}

/** Index order = bit order. Only append. */
export const TECHS: readonly TechSpec[] = [
  spec("drill", "army", 1, null),
  spec("fortify", "army", 2, "drill"),
  spec("conscription", "army", 3, "fortify"),
  spec("gunnery", "navy", 1, null),
  spec("hulls", "navy", 2, "gunnery"),
  spec("engines", "navy", 3, "hulls"),
  spec("sam_radar", "air", 1, null),
  spec("heavy_bombers", "air", 2, "sam_radar"),
  spec("interceptors", "air", 3, "heavy_bombers"),
  spec("trade", "economy", 1, null),
  spec("industry", "economy", 2, "trade"),
  spec("construction", "economy", 3, "industry"),
  spec("flak_shells", "air", 1, null),
  spec("jet_engines", "air", 2, "flak_shells"),
  spec("carpet_bombing", "air", 3, "jet_engines"),
  spec("naval_radar", "navy", 1, null),
  spec("torpedoes", "navy", 2, "naval_radar"),
  spec("armor_plating", "navy", 3, "torpedoes"),
];

/**
 * The effects, in one place (percent changes). Read by the engine
 * systems named in each comment.
 */
export const TECH_EFFECTS = {
  /** AttackExecution: attacker troop losses. */
  drillLossPercent: 90,
  /** AttackExecution: losses of attackers invading a fortified player. */
  fortifyAttackerLossPercent: 115,
  /** Config.troopIncreaseRate. */
  conscriptionGrowthPercent: 115,
  /** ShellExecution: warship shell damage. */
  gunneryDamagePercent: 120,
  /** ShellExecution: damage taken by warships. */
  hullsDamageTakenPercent: 75,
  /** WarshipExecution: extra path steps per 6 ticks. */
  enginesExtraSteps: 2,
  /** SAMLauncherExecution / anti-air: range. */
  samRangePercent: 125,
  /** BomberExecution: extra bombs per raid. */
  heavyBomberExtraShots: 2,
  /** Fighters and anti-air: damage. */
  interceptorDamagePercent: 150,
  /** Trade ships and trains: gold. */
  tradeGoldPercent: 115,
  /** Income buildings: gold. */
  industryIncomePercent: 125,
  /** Structure build costs. */
  constructionCostPercent: 85,
  /** Anti-air: Flak gun damage. */
  flakShellsDamagePercent: 150,
  /** Rocket bomber: extra tiles per tick. */
  jetEnginesExtraSpeed: 1,
  /** Rocket bomber: airbase reload. */
  jetEnginesReloadPercent: 67,
  /** Rocket bomber: bombs per run. */
  carpetBombingBombsPercent: 150,
  /** Anti-air: warships' range and damage. */
  navalRadarPercent: 140,
  /** ShellExecution: damage of submarine torpedoes. */
  torpedoDamagePercent: 150,
  /** ShellExecution: damage taken by warships (stacks with Hulls). */
  armorPlatingDamageTakenPercent: 80,
} as const;

export function techIndex(id: TechId): number {
  return TECH_IDS.indexOf(id);
}

export function techSpec(id: TechId): TechSpec {
  return TECHS[techIndex(id)];
}

export function hasTech(mask: number, id: TechId): boolean {
  return (mask & (1 << techIndex(id))) !== 0;
}

export function withTech(mask: number, id: TechId): number {
  return mask | (1 << techIndex(id));
}

/** Researched techs of a mask, in tree order. */
export function techsOf(mask: number): TechId[] {
  return TECH_IDS.filter((id) => hasTech(mask, id));
}

export type ResearchBlock =
  | "researched"
  | "busy"
  | "locked"
  | "gold"
  | "disabled"
  | null;

/**
 * Why `id` cannot be researched now, or null if it can.
 * @param researching the tech in progress, if any
 */
export function researchBlock(
  id: TechId,
  mask: number,
  researching: TechId | null,
  gold: bigint,
  enabled: boolean,
): ResearchBlock {
  if (!enabled) return "disabled";
  if (hasTech(mask, id)) return "researched";
  if (researching !== null) return "busy";
  const s = techSpec(id);
  if (s.requires !== null && !hasTech(mask, s.requires)) return "locked";
  if (gold < s.cost) return "gold";
  return null;
}

/** Scale an integer by a percentage, rounding down. */
export function techPercent(value: number, percent: number): number {
  return Math.floor((value * percent) / 100);
}

/** Scale a bigint by a percentage, rounding down. */
export function techPercentBig(value: bigint, percent: number): bigint {
  return (value * BigInt(percent)) / 100n;
}
