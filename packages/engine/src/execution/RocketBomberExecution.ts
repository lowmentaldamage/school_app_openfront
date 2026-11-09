/**
 * RocketBomberExecution — one rocket bomber run (rules:
 * engine-lib/air/RocketBomber.ts).
 *
 * The nearest ready Airbase within range of the line's start launches a
 * jet bomber. It flies to the start of the line, drops its bombs evenly
 * along it (10 / 25 / 50 by airbase level), and flies home. Anti-air (SAMs,
 * Flak, warships) can shoot it down on the way; fighters intercept it
 * (AirbaseExecution). Deterministic: straight-line flight on the tile grid.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { ANTI_AIR } from "@laukolaroser/engine-lib/air/Air";
import {
  airbaseReady,
  bombLine,
  bombsForLevel,
  ROCKET_BOMBER,
} from "@laukolaroser/engine-lib/air/RocketBomber";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import { TECH_EFFECTS } from "@laukolaroser/engine-lib/tech/Tech";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { antiAirFire, stepToward } from "./AirExecutions";
import { ProjectileExecution } from "./ProjectileExecution";

export type BomberRunRejection =
  | "invalid_tile"
  | "no_airbase"
  | "reloading"
  | "out_of_range"
  | "not_enough_gold";

function chebyshev(mg: Game, a: TileRef, b: TileRef): number {
  return Math.max(Math.abs(mg.x(a) - mg.x(b)), Math.abs(mg.y(a) - mg.y(b)));
}

/**
 * The airbase that would fly a run starting at `from` now: the nearest
 * finished, ready airbase in range. `why` says what is missing otherwise.
 */
export function pickAirbase(
  mg: Game,
  player: Player,
  from: TileRef,
  why: { reason: BomberRunRejection | null } = { reason: null },
): Unit | null {
  const bases = player
    .units(UnitType.Airbase)
    .filter((u) => !u.isUnderConstruction());
  if (bases.length === 0) {
    why.reason = "no_airbase";
    return null;
  }
  const range2 = ROCKET_BOMBER.range * ROCKET_BOMBER.range;
  let best: Unit | null = null;
  let bestD = Infinity;
  let anyInRange = false;
  for (const u of bases) {
    const d = mg.euclideanDistSquared(u.tile(), from);
    if (d > range2) continue;
    anyInRange = true;
    if (!airbaseReady(u.missileTimerQueue(), mg.ticks())) continue;
    if (d < bestD || (d === bestD && u.id() < best!.id())) {
      best = u;
      bestD = d;
    }
  }
  if (best === null) why.reason = anyInRange ? "reloading" : "out_of_range";
  return best;
}

export class RocketBomberExecution implements Execution {
  /** Set after init; null when the run took off. */
  rejection: BomberRunRejection | null = null;
  private mg: Game | null = null;
  private active = true;
  private bomber: Unit | null = null;
  private base: TileRef = 0;
  /** Drop points (tile refs), in flight order. */
  private drops: TileRef[] = [];
  private nextDrop = 0;
  private returning = false;
  private ticksFlown = 0;

  constructor(
    private player: Player,
    private from: TileRef,
    private to: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.isValidRef(this.from) || !mg.isValidRef(this.to)) {
      this.reject("invalid_tile");
      return;
    }
    const why: { reason: BomberRunRejection | null } = { reason: null };
    const airbase = pickAirbase(mg, this.player, this.from, why);
    if (airbase === null) {
      this.reject(why.reason ?? "no_airbase");
      return;
    }
    const cost = mg.config().strikeCost(ROCKET_BOMBER.cost, this.player);
    if (this.player.gold() < cost) {
      this.reject("not_enough_gold");
      return;
    }
    if (cost > 0n) this.player.removeGold(cost);
    // Forget runs that have reloaded, then log this one.
    while (
      airbase.missileTimerQueue().length > 0 &&
      ticks - airbase.missileTimerQueue()[0] >= ROCKET_BOMBER.cooldownTicks
    ) {
      airbase.reloadMissile();
    }
    airbase.launch();
    this.base = airbase.tile();
    // Tech: Heavy Bombers add bombs to every run.
    const count =
      bombsForLevel(airbase.level()) +
      (this.player.hasTech("heavy_bombers")
        ? TECH_EFFECTS.heavyBomberExtraShots * 2
        : 0);
    this.drops = bombLine(
      mg.x(this.from),
      mg.y(this.from),
      mg.x(this.to),
      mg.y(this.to),
      count,
      mg.width(),
      mg.height(),
    ).map(([x, y]) => mg.ref(x, y));
  }

  private reject(reason: BomberRunRejection): void {
    this.rejection = reason;
    this.active = false;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    if (this.bomber === null) {
      this.bomber = this.player.buildUnit(UnitType.Bomber, this.base, {
        targetTile: this.drops[0],
      });
      return;
    }
    const bomber = this.bomber;
    if (!bomber.isActive()) {
      this.active = false;
      return;
    }
    this.ticksFlown++;
    if (
      this.ticksFlown % ANTI_AIR.volleyTicks === 0 &&
      antiAirFire(mg, bomber, this.player)
    ) {
      this.active = false;
      return;
    }
    for (let i = 0; i < ROCKET_BOMBER.speed; i++) {
      const dest = this.returning ? this.base : this.drops[this.nextDrop];
      const next = stepToward(mg, bomber.tile(), dest);
      if (next !== bomber.tile()) bomber.move(next);
      if (this.returning) {
        if (bomber.tile() === this.base) {
          bomber.setReachedTarget();
          bomber.delete(false);
          this.active = false;
          return;
        }
        continue;
      }
      // Drop every bomb whose point the bomber has reached.
      while (
        this.nextDrop < this.drops.length &&
        chebyshev(mg, bomber.tile(), this.drops[this.nextDrop]) <= 1
      ) {
        this.dropBomb(this.drops[this.nextDrop], ticks);
        this.nextDrop++;
      }
      if (this.nextDrop >= this.drops.length) {
        this.returning = true;
      }
    }
  }

  private dropBomb(dst: TileRef, _ticks: number): void {
    this.mg!.addExecution(
      new ProjectileExecution(
        this.player,
        "airstrike",
        this.bomber!.tile(),
        dst,
        0,
        1,
        ROCKET_BOMBER.tilesTaken,
      ),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return RocketBomberSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      player: w.player(this.player),
      from: this.from,
      to: this.to,
      base: this.base,
      drops: this.drops,
      nextDrop: this.nextDrop,
      bomber: w.unitOrNull(this.bomber),
      returning: this.returning,
      ticksFlown: this.ticksFlown,
    });
  }

  restoreSnapshot(s: RocketBomberState, r: SnapshotReader): void {
    this.rejection = null;
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.player = r.player(s.player);
    this.from = s.from;
    this.to = s.to;
    this.base = s.base;
    this.drops = [...s.drops];
    this.nextDrop = s.nextDrop;
    this.bomber = r.unitOrNull(s.bomber);
    this.returning = s.returning;
    this.ticksFlown = s.ticksFlown;
  }
}

const RocketBomberStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  from: zTile(),
  to: zTile(),
  base: zTile(),
  drops: z.array(zTile()),
  nextDrop: zInt(),
  bomber: zRef().nullable(),
  returning: z.boolean(),
  ticksFlown: zInt(),
});
type RocketBomberState = z.infer<typeof RocketBomberStateSchema>;

export const RocketBomberSnapshot = execSnapshotType({
  name: "RocketBomber",
  version: 1,
  schema: RocketBomberStateSchema,
  cls: () => RocketBomberExecution,
});
