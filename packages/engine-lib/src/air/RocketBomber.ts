/**
 * Rocket bomber: the one aimed weapon. The player drags a line on the map;
 * a jet bomber takes off from their nearest ready Airbase, flies to the
 * start of the line and drops a stick of bombs evenly along it, then flies
 * home. Each bomb kills troops around it, damages buildings, hits ships and
 * takes a few tiles of enemy land.
 *
 * Shared by the engine and the client (button state, previews). Integer
 * maths only.
 */

import type { TileRef } from "@laukolaroser/engine-api/game/GameMap";

export const ROCKET_BOMBER = {
  /** Gold per run (free with infinite gold, like other strikes). */
  cost: 150_000n,
  /** Ticks an airbase needs between runs (30 s at 10 ticks/s). */
  cooldownTicks: 300,
  /** Tiles per tick. */
  speed: 3,
  /** Longest line (tiles); longer drags are cut to this. */
  maxLineLength: 120,
  /** How far from an airbase the line may start (tiles). */
  range: 450,
  /** Blast radius of one bomb (tiles). */
  bombRadius: 2,
  /** Enemy land tiles one bomb takes. */
  tilesTaken: 3,
  /** Troops killed per enemy tile in the blast. */
  troopsPerTile: 9,
  /** Damage to an enemy warship in the blast. */
  shipDamage: 250,
  maxHealth: 400,
} as const;

/** Bombs per run for an airbase of `level`: 10, 25, then 50. */
export function bombsForLevel(level: number): number {
  if (level >= 3) return 50;
  if (level === 2) return 25;
  return 10;
}

/**
 * The drop points of a run: `count` points spread evenly along the line
 * from (x0, y0) to (x1, y1), the line cut to maxLineLength. Integer tiles,
 * clamped to the map.
 */
export function bombLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  count: number,
  width: number,
  height: number,
): [number, number][] {
  let dx = x1 - x0;
  let dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const max = ROCKET_BOMBER.maxLineLength;
  if (len2 > max * max) {
    // Integer scale-down: keep the direction, cut the length.
    const len = Math.floor(Math.sqrt(len2));
    dx = Math.trunc((dx * max) / len);
    dy = Math.trunc((dy * max) / len);
  }
  const out: [number, number][] = [];
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) {
    const num = n === 1 ? 0 : i;
    const den = n === 1 ? 1 : n - 1;
    const x = x0 + Math.trunc((dx * num) / den);
    const y = y0 + Math.trunc((dy * num) / den);
    out.push([
      Math.max(0, Math.min(width - 1, x)),
      Math.max(0, Math.min(height - 1, y)),
    ]);
  }
  return out;
}

/** Whether an airbase whose launch history is `queue` can fly at `tick`. */
export function airbaseReady(queue: readonly number[], tick: number): boolean {
  for (const t of queue) {
    if (tick - t < ROCKET_BOMBER.cooldownTicks) return false;
  }
  return true;
}

/** Ticks until an airbase can fly again (0 when ready). */
export function airbaseReloadLeft(
  queue: readonly number[],
  tick: number,
): number {
  let left = 0;
  for (const t of queue) {
    left = Math.max(left, ROCKET_BOMBER.cooldownTicks - (tick - t));
  }
  return Math.max(0, left);
}

export type BomberRunTarget = { from: TileRef; to: TileRef };
