/**
 * WeaponStrikeExecution — a player fires a weapon at a tile.
 *
 * Validates the strike (target not self/ally/teammate, a ready launcher of
 * the right kind within range, enough gold), charges the price, puts the
 * launcher on cooldown and launches one ProjectileExecution per shot. All
 * rules come from engine-lib/weapons/Weapons.ts.
 *
 * Launchers reuse Unit.launch()/missileTimerQueue for cooldown, so no new
 * persistent state is needed: missile silos are reloaded by their own
 * MissileSiloExecution (a rocket uses a silo slot, like a nuke); defense
 * posts and warships are reloaded here, lazily, once their weapon cooldown
 * has passed.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import {
  UnitType,
  type WeaponId,
} from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  zNum,
  zPlayerRef,
} from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import {
  WEAPONS,
  type WeaponSpec,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ProjectileExecution } from "./ProjectileExecution";

/** Why a strike could not be fired (exposed for tests and the UI). */
export type StrikeRejection =
  | "invalid_tile"
  | "friendly_target"
  | "no_launcher"
  | "not_enough_gold";

/**
 * True when the launcher can fire now. Defense posts and warships are
 * reloaded here once their cooldown has elapsed (silos reload themselves).
 */
export function launcherReady(mg: Game, unit: Unit, spec: WeaponSpec): boolean {
  if (!unit.isActive() || unit.isUnderConstruction()) return false;
  if (unit.type() !== UnitType.MissileSilo) {
    const q = unit.missileTimerQueue();
    while (q.length > 0 && mg.ticks() - q[0] >= spec.cooldownTicks) {
      unit.reloadMissile();
    }
  }
  return !unit.isInCooldown();
}

/** The nearest ready launcher of `player` within range of `tile`, if any. */
export function findLauncher(
  mg: Game,
  player: Player,
  spec: WeaponSpec,
  tile: TileRef,
): Unit | null {
  const range2 = spec.range * spec.range;
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of player.units(spec.launcher)) {
    const d = mg.euclideanDistSquared(u.tile(), tile);
    if (d > range2 || d >= bestD) continue;
    if (!launcherReady(mg, u, spec)) continue;
    best = u;
    bestD = d;
  }
  return best;
}

export class WeaponStrikeExecution implements Execution {
  /** Set after init; null when the strike was fired. */
  rejection: StrikeRejection | null = null;

  constructor(
    private player: Player,
    private weapon: WeaponId,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    const spec = WEAPONS[this.weapon];
    if (spec === undefined || !mg.isValidRef(this.tile)) {
      this.rejection = "invalid_tile";
      return;
    }
    const owner = mg.owner(this.tile);
    if (
      owner.isPlayer() &&
      (owner === this.player || this.player.isFriendly(owner))
    ) {
      this.rejection = "friendly_target";
      return;
    }
    const launcher = findLauncher(mg, this.player, spec, this.tile);
    if (launcher === null) {
      this.rejection = "no_launcher";
      return;
    }
    if (this.player.gold() < spec.cost) {
      this.rejection = "not_enough_gold";
      return;
    }
    this.player.removeGold(spec.cost);
    launcher.launch();

    // Shots scatter around the aim point (seeded: identical on every client).
    const rand = new PseudoRandom(ticks * 7919 + this.tile);
    const w = mg.width();
    const h = mg.height();
    const ax = mg.x(this.tile);
    const ay = mg.y(this.tile);
    for (let i = 0; i < spec.shots; i++) {
      let dst = this.tile;
      if (i > 0 && spec.spread > 0) {
        const dx = rand.nextInt(-spec.spread, spec.spread + 1);
        const dy = rand.nextInt(-spec.spread, spec.spread + 1);
        const x = Math.max(0, Math.min(w - 1, ax + dx));
        const y = Math.max(0, Math.min(h - 1, ay + dy));
        dst = mg.ref(x, y);
      }
      mg.addExecution(
        new ProjectileExecution(
          this.player,
          this.weapon,
          launcher.tile(),
          dst,
          i * spec.shotInterval,
        ),
      );
    }
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return WeaponStrikeExecutionSnapshot.write({
      player: w.player(this.player),
      weapon: this.weapon,
      tile: this.tile,
    });
  }

  restoreSnapshot(s: WeaponStrikeState, r: SnapshotReader): void {
    this.rejection = null;
    this.player = r.player(s.player);
    this.weapon = s.weapon as WeaponId;
    this.tile = s.tile;
  }
}

const WeaponStrikeStateSchema = z.object({
  player: zPlayerRef(),
  weapon: z.string(),
  // Untrusted intent data (validated in init), so any number.
  tile: zNum(),
});
type WeaponStrikeState = z.infer<typeof WeaponStrikeStateSchema>;

export const WeaponStrikeExecutionSnapshot = execSnapshotType({
  name: "WeaponStrike",
  version: 1,
  schema: WeaponStrikeStateSchema,
  cls: () => WeaponStrikeExecution,
});
