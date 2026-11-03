import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import { RailUnits, UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  ARMORED_TRAIN,
  RAIL_SAM,
  RAIL_UNITS,
  type RailUnitType,
  TROOP_TRAIN,
} from "@laukolaroser/engine-lib/rail/RailUnits";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zRef,
  zTile,
  zTiles,
} from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../game/Game";
import { getOrientedRailroad } from "../game/Railroad";
import { TrainStation } from "../game/TrainStation";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ProjectileExecution } from "./ProjectileExecution";
import { SAMMissileExecution } from "./SAMMissileExecution";

export interface RailUnitParams {
  owner: Player;
  /** Where the player clicked; the train starts at the nearest own station. */
  tile: TileRef;
  type: RailUnitType;
}

/** Ticks between retries when there is nowhere to go. */
const IDLE_RETRY_TICKS = 50;
/** A stranded train (its station gone, no other nearby) waits this long. */
const STRANDED_TICKS = 300;
/** Max distance to re-attach to a station after the current one is lost. */
const REATTACH_RADIUS = 6;

const NUKE_TYPES = [
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
] as const;

/**
 * A military train (Armored Train, Troop Train, Rail SAM) patrolling its
 * owner's rail network: it rides from station to station, picking the next
 * own station in the same rail cluster at random (seeded), and does its job
 * along the way. Rules and numbers: engine-lib/rail/RailUnits.ts.
 */
export class RailUnitExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private unit: Unit | null = null;
  private random: PseudoRandom | null = null;
  /** Station the train is at or last left. */
  private station: TrainStation | null = null;
  /** Station it is riding to (null while idle). */
  private target: TrainStation | null = null;
  private path: TileRef[] = [];
  private pathIndex = 0;
  private idleUntil = 0;
  private strandedSince = -1;
  private lastAction = -1_000_000;

  constructor(private input: RailUnitParams | Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.unit = this.input;
    } else {
      const { owner, tile, type } = this.input;
      const spawn = owner.canBuild(type, tile);
      if (spawn === false) {
        console.warn(`cannot build ${type}`);
        this.active = false;
        return;
      }
      this.unit = owner.buildUnit(type, spawn, {});
    }
    this.random = new PseudoRandom(ticks * 31 + this.unit.id());
    this.station = this.stationAt(this.unit.tile());
  }

  tick(ticks: number): void {
    const mg = this.mg;
    const unit = this.unit;
    if (mg === null || unit === null) return;
    if (!unit.isActive()) {
      this.active = false;
      return;
    }
    this.move(ticks);
    if (!unit.isActive()) {
      this.active = false;
      return;
    }
    switch (unit.type()) {
      case UnitType.ArmoredTrain:
        this.armoredTrainGuns(ticks);
        break;
      case UnitType.RailSAM:
        this.railSam(ticks);
        break;
    }
  }

  // --- Movement -----------------------------------------------------------

  private move(ticks: number): void {
    const unit = this.unit!;
    if (this.target === null) {
      if (ticks < this.idleUntil) return;
      if (!this.planLeg(ticks)) return;
    }
    const target = this.target!;
    if (!target.isActive() || target.unit.owner() !== unit.owner()) {
      // Destination lost: stop where we are and look for a station.
      this.target = null;
      this.station = this.nearestOwnStation(unit.tile());
      this.idleUntil = ticks + 1;
      return;
    }
    const speed = RAIL_UNITS[unit.type() as RailUnitType].speed;
    for (let i = 0; i < speed && this.pathIndex < this.path.length; i++) {
      unit.move(this.path[this.pathIndex++]);
    }
    if (this.pathIndex >= this.path.length) {
      unit.move(target.tile());
      this.station = target;
      this.target = null;
      this.onArrive(target);
    }
  }

  /** Pick the next station and the rail path to it. */
  private planLeg(ticks: number): boolean {
    const unit = this.unit!;
    const mg = this.mg!;
    let from = this.station;
    if (
      from === null ||
      !from.isActive() ||
      from.unit.owner() !== unit.owner()
    ) {
      from = this.nearestOwnStation(unit.tile());
      this.station = from;
    }
    if (from === null) {
      // Stranded: the line was cut. Give it a while, then it is lost.
      if (this.strandedSince < 0) this.strandedSince = ticks;
      if (ticks - this.strandedSince >= STRANDED_TICKS) unit.delete(false);
      this.idleUntil = ticks + IDLE_RETRY_TICKS;
      return false;
    }
    this.strandedSince = -1;
    const cluster = from.getCluster();
    const candidates: TrainStation[] = [];
    if (cluster !== null) {
      for (const st of mg.railNetwork().stationManager().getAll()) {
        if (
          st !== from &&
          st.isActive() &&
          st.unit.owner() === unit.owner() &&
          st.getCluster() === cluster
        ) {
          candidates.push(st);
        }
      }
    }
    if (candidates.length === 0) {
      this.idleUntil = ticks + IDLE_RETRY_TICKS;
      return false;
    }
    // Deterministic order (station ids), then a seeded pick.
    candidates.sort((a, b) => a.unit.id() - b.unit.id());
    const to = candidates[this.random!.nextInt(0, candidates.length)];
    const stations = mg.railNetwork().findStationsPath(from, to);
    if (stations.length < 2) {
      this.idleUntil = ticks + IDLE_RETRY_TICKS;
      return false;
    }
    const path: TileRef[] = [];
    for (let i = 0; i + 1 < stations.length; i++) {
      const seg = getOrientedRailroad(stations[i], stations[i + 1]);
      if (seg === null) {
        this.idleUntil = ticks + IDLE_RETRY_TICKS;
        return false;
      }
      path.push(...seg.getTiles());
    }
    this.path = path;
    this.pathIndex = 0;
    this.target = to;
    return true;
  }

  private stationAt(tile: TileRef): TrainStation | null {
    for (const st of this.mg!.railNetwork().stationManager().getAll()) {
      if (st.isActive() && st.tile() === tile) return st;
    }
    return null;
  }

  private nearestOwnStation(tile: TileRef): TrainStation | null {
    const mg = this.mg!;
    const owner = this.unit!.owner();
    const r2 = REATTACH_RADIUS * REATTACH_RADIUS;
    let best: TrainStation | null = null;
    let bestD = Infinity;
    let bestId = Infinity;
    for (const st of mg.railNetwork().stationManager().getAll()) {
      if (!st.isActive() || st.unit.owner() !== owner) continue;
      if (st.getRailroads().size === 0) continue;
      const d = mg.euclideanDistSquared(st.tile(), tile);
      if (d > r2) continue;
      if (d < bestD || (d === bestD && st.unit.id() < bestId)) {
        best = st;
        bestD = d;
        bestId = st.unit.id();
      }
    }
    return best;
  }

  private onArrive(station: TrainStation): void {
    const unit = this.unit!;
    if (
      unit.type() === UnitType.TroopTrain &&
      station.unit.type() === UnitType.City &&
      station.unit.owner() === unit.owner()
    ) {
      const owner = unit.owner();
      const max = this.mg!.config().maxTroops(owner);
      const perMille =
        TROOP_TRAIN.perMilleOfMaxTroops +
        TROOP_TRAIN.perMillePerCityLevel *
          Math.max(0, station.unit.level() - 1);
      const room = Math.max(0, max - owner.troops());
      const troops = Math.min(room, Math.floor((max * perMille) / 1000));
      if (troops > 0) owner.addTroops(troops);
    }
  }

  // --- Weapons ------------------------------------------------------------

  /** Players the owner is fighting a land war with (attack either way). */
  private enemiesAtWar(): Set<Player> {
    const owner = this.unit!.owner();
    const enemies = new Set<Player>();
    for (const a of owner.outgoingAttacks()) {
      const t = a.target();
      if (t.isPlayer()) enemies.add(t);
    }
    for (const a of owner.incomingAttacks()) enemies.add(a.attacker());
    for (const e of enemies) {
      if (e === owner || owner.isFriendly(e)) enemies.delete(e);
    }
    return enemies;
  }

  private armoredTrainGuns(ticks: number): void {
    if (ticks - this.lastAction < ARMORED_TRAIN.reloadTicks) return;
    const enemies = this.enemiesAtWar();
    if (enemies.size === 0) return;
    const mg = this.mg!;
    const unit = this.unit!;
    const cx = mg.x(unit.tile());
    const cy = mg.y(unit.tile());
    const range = ARMORED_TRAIN.range;
    let best: TileRef | null = null;
    let bestD = Infinity;
    for (let dy = -range; dy <= range; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= mg.height()) continue;
      for (let dx = -range; dx <= range; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= mg.width()) continue;
        const d = dx * dx + dy * dy;
        if (d > range * range || d >= bestD) continue;
        const t = mg.ref(x, y);
        if (!mg.isLand(t)) continue;
        const o = mg.owner(t);
        if (!o.isPlayer() || !enemies.has(o)) continue;
        best = t;
        bestD = d;
      }
    }
    if (best === null) return;
    this.lastAction = ticks;
    for (let i = 0; i < ARMORED_TRAIN.shots; i++) {
      mg.addExecution(
        new ProjectileExecution(
          unit.owner(),
          "artillery",
          unit.tile(),
          best,
          i * 4,
        ),
      );
    }
  }

  private railSam(ticks: number): void {
    if (ticks - this.lastAction < RAIL_SAM.reloadTicks) return;
    const mg = this.mg!;
    if (NUKE_TYPES.every((t) => mg.unitCount(t) === 0)) return;
    const unit = this.unit!;
    const owner = unit.owner();
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const { unit: nuke, distSquared } of mg.nearbyUnits(
      unit.tile(),
      RAIL_SAM.range,
      NUKE_TYPES,
    )) {
      const o = nuke.owner();
      if (o === owner || owner.isFriendly(o)) continue;
      if (!nuke.isActive() || nuke.targetedBySAM()) continue;
      if (
        distSquared < bestD ||
        (distSquared === bestD && nuke.id() < best!.id())
      ) {
        best = nuke;
        bestD = distSquared;
      }
    }
    if (best === null) return;
    // Aim a little ahead along the nuke's flight path.
    const traj = best.trajectory();
    const ahead = Math.max(1, Math.floor(Math.sqrt(bestD) / 6));
    const idx = Math.min(traj.length - 2, best.trajectoryIndex() + ahead);
    const aim = idx >= 0 && traj[idx] !== undefined ? traj[idx] : best.tile();
    this.lastAction = ticks;
    best.setTargetedBySAM(true);
    mg.addExecution(
      new SAMMissileExecution(unit.tile(), owner, unit, best, aim),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return RailUnitExecutionSnapshot.write({
      input: isUnit(this.input)
        ? { unit: w.unit(this.input) }
        : {
            owner: w.player(this.input.owner),
            tile: this.input.tile,
            type: this.input.type,
          },
      active: this.active,
      initialized: this.mg !== null,
      unit: w.unitOrNull(this.unit),
      random: this.random === null ? null : w.random(this.random),
      station: this.station === null ? null : w.station(this.station),
      target: this.target === null ? null : w.station(this.target),
      path: w.tiles(this.path),
      pathIndex: this.pathIndex,
      idleUntil: this.idleUntil,
      strandedSince: this.strandedSince,
      lastAction: this.lastAction,
    });
  }

  restoreSnapshot(s: RailUnitState, r: SnapshotReader): void {
    this.input =
      "unit" in s.input
        ? r.unit(s.input.unit)
        : {
            owner: r.player(s.input.owner),
            tile: s.input.tile,
            type: s.input.type as RailUnitType,
          };
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.unit = r.unitOrNull(s.unit);
    this.random = s.random === null ? null : r.random(s.random);
    this.station = s.station === null ? null : r.station(s.station);
    this.target = s.target === null ? null : r.station(s.target);
    this.path = Array.from(s.path);
    this.pathIndex = s.pathIndex;
    this.idleUntil = s.idleUntil;
    this.strandedSince = s.strandedSince;
    this.lastAction = s.lastAction;
  }
}

const RailUnitStateSchema = z.object({
  input: z.union([
    z.object({ unit: zRef() }),
    z.object({
      owner: zPlayerRef(),
      tile: zTile(),
      type: z.enum(RailUnits.types),
    }),
  ]),
  active: z.boolean(),
  initialized: z.boolean(),
  unit: zRef().nullable(),
  random: zRandom().nullable(),
  station: zRef().nullable(),
  target: zRef().nullable(),
  path: zTiles(),
  pathIndex: zInt(),
  idleUntil: zInt(),
  strandedSince: zInt(),
  lastAction: zInt(),
});
type RailUnitState = z.infer<typeof RailUnitStateSchema>;

export const RailUnitExecutionSnapshot = execSnapshotType({
  name: "RailUnit",
  version: 1,
  schema: RailUnitStateSchema,
  cls: () => RailUnitExecution,
});
