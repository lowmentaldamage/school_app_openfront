/**
 * Defense extras (engine-lib/defense/Defenses.ts):
 *
 *  - CoastalBatteryExecution: a shore gun that fires shells at the nearest
 *    enemy warship, spotted submarine or transport in range.
 *  - SeaMineExecution: a hidden mine that blows up the first enemy ship
 *    that comes within trigger range; destroyers sweep mines safely.
 *
 * Forts need no execution: AttackExecution checks for one near the tile.
 */

import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import {
  batteryReload,
  COASTAL_BATTERY,
  SEA_MINE,
} from "@laukolaroser/engine-lib/defense/Defenses";
import { SUBMARINE_DETECT_RANGE } from "@laukolaroser/engine-lib/naval/NavalClasses";
import { zInt, zRef } from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShellExecution } from "./ShellExecution";
import { onFriendlyRadar } from "./WarshipExecution";

const BATTERY_TARGETS = [
  UnitType.Warship,
  UnitType.Destroyer,
  UnitType.Battleship,
  UnitType.Submarine,
  UnitType.Carrier,
  UnitType.TransportShip,
] as const;

const MINE_VICTIMS = [
  UnitType.Warship,
  UnitType.Destroyer,
  UnitType.Battleship,
  UnitType.Submarine,
  UnitType.Carrier,
  UnitType.TransportShip,
  UnitType.TradeShip,
] as const;

function isEnemy(owner: Player, other: Player): boolean {
  return (
    other !== owner &&
    !owner.isFriendly(other) &&
    owner.canAttackPlayer(other, true)
  );
}

export class CoastalBatteryExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private nextShot = 0;

  constructor(private battery: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.nextShot = ticks + batteryReload(this.battery.level());
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    const b = this.battery;
    if (!b.isActive()) {
      this.active = false;
      return;
    }
    if (b.isUnderConstruction() || ticks < this.nextShot) return;
    const owner = b.owner();
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const { unit, distSquared } of mg.nearbyUnits(
      b.tile(),
      COASTAL_BATTERY.range,
      [...BATTERY_TARGETS],
    )) {
      if (!unit.isActive() || !isEnemy(owner, unit.owner())) continue;
      // Submarines only when spotted (close, or on friendly radar).
      if (
        unit.type() === UnitType.Submarine &&
        distSquared > SUBMARINE_DETECT_RANGE * SUBMARINE_DETECT_RANGE &&
        !onFriendlyRadar(mg, unit.tile(), owner)
      ) {
        continue;
      }
      if (distSquared < bestD) {
        best = unit;
        bestD = distSquared;
      }
    }
    if (best === null) return;
    this.nextShot = ticks + batteryReload(b.level());
    mg.addExecution(new ShellExecution(b.tile(), owner, b, best));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CoastalBatterySnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      battery: w.unit(this.battery),
      nextShot: this.nextShot,
    });
  }

  restoreSnapshot(s: CoastalBatteryState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.battery = r.unit(s.battery);
    this.nextShot = s.nextShot;
  }
}

const CoastalBatteryStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  battery: zRef(),
  nextShot: zInt(),
});
type CoastalBatteryState = z.infer<typeof CoastalBatteryStateSchema>;

export const CoastalBatterySnapshot = execSnapshotType({
  name: "CoastalBattery",
  version: 1,
  schema: CoastalBatteryStateSchema,
  cls: () => CoastalBatteryExecution,
});

export class SeaMineExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(private mine: Unit) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    const m = this.mine;
    if (!m.isActive()) {
      this.active = false;
      return;
    }
    if (m.isUnderConstruction() || ticks % SEA_MINE.checkTicks !== 0) return;
    const owner = m.owner();
    for (const { unit } of mg.nearbyUnits(m.tile(), SEA_MINE.triggerRange, [
      ...MINE_VICTIMS,
    ])) {
      if (!unit.isActive() || !isEnemy(owner, unit.owner())) continue;
      // Destroyers sweep mines: the mine is cleared, the ship unharmed.
      if (unit.type() !== UnitType.Destroyer) {
        if (
          unit.type() === UnitType.TransportShip ||
          unit.type() === UnitType.TradeShip
        ) {
          unit.delete(true, owner);
        } else {
          unit.modifyHealth(-SEA_MINE.damage, owner);
          if (unit.isActive() && unit.health() <= 0) unit.delete(true, owner);
        }
      }
      m.delete(true, unit.owner());
      this.active = false;
      return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SeaMineSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      mine: w.unit(this.mine),
    });
  }

  restoreSnapshot(s: SeaMineState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.mine = r.unit(s.mine);
  }
}

const SeaMineStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  mine: zRef(),
});
type SeaMineState = z.infer<typeof SeaMineStateSchema>;

export const SeaMineSnapshot = execSnapshotType({
  name: "SeaMine",
  version: 1,
  schema: SeaMineStateSchema,
  cls: () => SeaMineExecution,
});
