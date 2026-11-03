/**
 * ProjectileExecution — one artillery shell or rocket in flight.
 *
 * Flies a parabola from the launcher to its target tile (like a nuke, but
 * fast and conventional), then resolves the impact:
 *   - the target nation loses troops in proportion to how much of its land
 *     the blast covers (strikeTroopLoss),
 *   - enemy transports, trade ships and trains in the blast are destroyed,
 *     enemy warships take damage,
 *   - rockets knock the nearest enemy building down a level.
 * Territory never changes hands. Friendly units and land are never hurt.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import {
  CombatShips,
  MessageType,
  Structures,
  UnitType,
  type WeaponId,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import {
  strikeTroopLoss,
  WEAPONS,
  type WeaponSpec,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  ParabolaSchema,
  parabolaState,
  restoreParabola,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** Spelled out so the translation-key checker can see them. */
const HIT_MESSAGE_KEYS: Record<WeaponId, string> = {
  artillery: "events_display.artillery_strike_hit",
  naval: "events_display.naval_strike_hit",
  rocket: "events_display.rocket_strike_hit",
  airstrike: "events_display.airstrike_hit",
};

const SHIP_TYPES = [
  UnitType.TransportShip,
  UnitType.TradeShip,
  UnitType.Train,
] as const;

/** Outcome of one impact (for tests and messages). */
export interface ImpactResult {
  troopsKilled: number;
  unitsDestroyed: number;
  warshipsHit: number;
  structuresHit: number;
}

export class ProjectileExecution implements Execution {
  private active = true;
  private mg: Game;
  private unit: Unit | null = null;
  private pathFinder: ParabolaUniversalPathFinder;
  /** Set when the projectile lands (tests read it). */
  impact: ImpactResult | null = null;

  constructor(
    private player: Player,
    private weapon: WeaponId,
    private src: TileRef,
    private dst: TileRef,
    private waitTicks: number,
  ) {}

  private get spec(): WeaponSpec {
    return WEAPONS[this.weapon];
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.spec.speed,
      directionUp: true,
    });
  }

  tick(_ticks: number): void {
    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }
    if (this.unit === null) {
      this.unit = this.player.buildUnit(this.spec.projectile, this.src, {
        targetTile: this.dst,
      });
      return;
    }
    if (!this.unit.isActive()) {
      this.active = false;
      return;
    }
    const result = this.pathFinder.next(this.src, this.dst, this.spec.speed);
    if (result.status === PathStatus.COMPLETE) {
      this.unit.move(this.dst);
      this.impact = this.detonate();
      this.unit.setReachedTarget();
      this.unit.delete(false);
      this.active = false;
    } else if (result.status === PathStatus.NEXT) {
      this.unit.move(result.node);
    } else {
      this.unit.delete(false);
      this.active = false;
    }
  }

  private isEnemy(other: Player): boolean {
    return other !== this.player && !this.player.isFriendly(other);
  }

  private detonate(): ImpactResult {
    const mg = this.mg;
    const spec = this.spec;
    const res: ImpactResult = {
      troopsKilled: 0,
      unitsDestroyed: 0,
      warshipsHit: 0,
      structuresHit: 0,
    };

    // Troops: proportional to the share of the target's land in the blast.
    const target = mg.owner(this.dst);
    if (target.isPlayer() && this.isEnemy(target)) {
      let tilesHit = 0;
      for (const t of mg.circleSearch(this.dst, spec.radius)) {
        if (mg.owner(t) === target) tilesHit++;
      }
      const loss = strikeTroopLoss(
        spec,
        target.troops(),
        target.numTilesOwned(),
        tilesHit,
      );
      if (loss > 0) res.troopsKilled = target.removeTroops(loss);
    }

    // Ships and trains in the blast.
    for (const { unit } of mg.nearbyUnits(this.dst, spec.radius, SHIP_TYPES)) {
      if (!unit.isActive() || !this.isEnemy(unit.owner())) continue;
      unit.delete(true, this.player);
      res.unitsDestroyed++;
    }
    for (const { unit } of mg.nearbyUnits(this.dst, spec.radius, [
      ...CombatShips.types,
    ])) {
      if (!unit.isActive() || !this.isEnemy(unit.owner())) continue;
      unit.modifyHealth(-spec.warshipDamage, this.player);
      res.warshipsHit++;
    }

    // Rockets: the nearest enemy building loses a level (level 1 → destroyed).
    if (spec.damagesStructures) {
      let nearest: Unit | null = null;
      let best = Infinity;
      for (const { unit, distSquared } of mg.nearbyUnits(
        this.dst,
        spec.radius,
        Structures.types,
      )) {
        if (!unit.isActive() || !this.isEnemy(unit.owner())) continue;
        if (distSquared < best) {
          best = distSquared;
          nearest = unit;
        }
      }
      if (nearest !== null) {
        nearest.decreaseLevel(this.player);
        res.structuresHit++;
      }
    }

    if (target.isPlayer() && this.isEnemy(target) && res.troopsKilled > 0) {
      mg.displayMessage(
        HIT_MESSAGE_KEYS[this.weapon],
        MessageType.UNIT_DESTROYED,
        target.id(),
        undefined,
        { name: this.player.displayName(), troops: res.troopsKilled },
      );
    }
    return res;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ProjectileExecutionSnapshot.write({
      active: this.active,
      pathFinder: this.mg === undefined ? null : parabolaState(this.pathFinder),
      unit: w.unitOrNull(this.unit),
      player: w.player(this.player),
      weapon: this.weapon,
      src: this.src,
      dst: this.dst,
      waitTicks: this.waitTicks,
    });
  }

  restoreSnapshot(s: ProjectileState, r: SnapshotReader): void {
    this.active = s.active;
    // In flight when snapshotted, so it has not landed yet.
    this.impact = null;
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreParabola(r.game, s.pathFinder);
    }
    this.unit = r.unitOrNull(s.unit);
    this.player = r.player(s.player);
    this.weapon = s.weapon as WeaponId;
    this.src = s.src;
    this.dst = s.dst;
    this.waitTicks = s.waitTicks;
  }
}

const ProjectileStateSchema = z.object({
  active: z.boolean(),
  pathFinder: ParabolaSchema.nullable(),
  unit: zRef().nullable(),
  player: zPlayerRef(),
  weapon: z.string(),
  src: zTile(),
  dst: zTile(),
  waitTicks: zInt(),
});
type ProjectileState = z.infer<typeof ProjectileStateSchema>;

export const ProjectileExecutionSnapshot = execSnapshotType({
  name: "Projectile",
  version: 1,
  schema: ProjectileStateSchema,
  cls: () => ProjectileExecution,
});
