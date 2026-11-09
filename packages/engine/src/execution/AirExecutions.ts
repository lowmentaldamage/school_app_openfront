/**
 * Air war executions (rules: engine-lib/air/Air.ts):
 *  - BomberExecution: one raid from an Airbase — flies out, drops a stick of
 *    bombs (airstrike-weapon impacts), flies home. Enemy SAM launchers and
 *    Rail SAMs in range fire at it; fighters intercept it.
 *  - FighterExecution: a fighter scrambled at an enemy bomber.
 *  - AirbaseExecution: scrambles fighters at enemy bombers in range.
 * Deterministic: straight-line flight on the tile grid, seeded bomb spread.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import {
  ANTI_AIR,
  BOMBER,
  FIGHTER,
  FLAK,
  SHIP_ANTI_AIR,
} from "@laukolaroser/engine-lib/air/Air";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import { TECH_EFFECTS } from "@laukolaroser/engine-lib/tech/Tech";
import {
  WEAPONS,
  weaponAtTier,
  type WeaponTier,
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

/** One step (8 directions) from `from` towards `to` on the tile grid. */
export function stepToward(mg: Game, from: TileRef, to: TileRef): TileRef {
  const fx = mg.x(from);
  const fy = mg.y(from);
  const dx = mg.x(to) - fx;
  const dy = mg.y(to) - fy;
  if (dx === 0 && dy === 0) return from;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sx = ax * 2 >= ay ? Math.sign(dx) : 0;
  const sy = ay * 2 >= ax ? Math.sign(dy) : 0;
  return mg.ref(fx + sx, fy + sy);
}

function chebyshev(mg: Game, a: TileRef, b: TileRef): number {
  return Math.max(Math.abs(mg.x(a) - mg.x(b)), Math.abs(mg.y(a) - mg.y(b)));
}

function hostile(a: Player, b: Player): boolean {
  return a !== b && !a.isFriendly(b);
}

/**
 * Anti-air fire at an enemy plane (one volley): SAM launchers, Rail SAMs,
 * Flak guns and warships in range. Returns true when it was shot down.
 */
export function antiAirFire(mg: Game, plane: Unit, owner: Player): boolean {
  const maxRange = Math.floor(
    (ANTI_AIR.range * TECH_EFFECTS.samRangePercent) / 100,
  );
  for (const { unit, distSquared } of mg.nearbyUnits(plane.tile(), maxRange, [
    UnitType.SAMLauncher,
    UnitType.RailSAM,
  ])) {
    if (unit.isUnderConstruction() || !hostile(unit.owner(), owner)) {
      continue;
    }
    // Tech: SAM Radar (range) and Interceptors (damage).
    const shooter = unit.owner();
    const range = shooter.hasTech("sam_radar") ? maxRange : ANTI_AIR.range;
    if (distSquared > range * range) continue;
    const damage = shooter.hasTech("interceptors")
      ? Math.floor(
          (ANTI_AIR.damage * TECH_EFFECTS.interceptorDamagePercent) / 100,
        )
      : ANTI_AIR.damage;
    plane.modifyHealth(-damage, shooter);
    // modifyHealth removes a unit whose health reaches 0.
    if (!plane.isActive() || plane.health() <= 0) {
      if (plane.isActive()) plane.delete(true, shooter);
      return true;
    }
  }
  // Flak guns (stronger per level) and warships' anti-aircraft guns.
  const flakRange = Math.max(FLAK.range, SHIP_ANTI_AIR.range);
  for (const { unit, distSquared } of mg.nearbyUnits(plane.tile(), flakRange, [
    UnitType.FlakGun,
    UnitType.Warship,
    UnitType.Destroyer,
    UnitType.Battleship,
    UnitType.Carrier,
  ])) {
    if (unit.isUnderConstruction() || !hostile(unit.owner(), owner)) {
      continue;
    }
    const isFlak = unit.type() === UnitType.FlakGun;
    const range = isFlak ? FLAK.range : SHIP_ANTI_AIR.range;
    if (distSquared > range * range) continue;
    const damage = isFlak
      ? Math.floor((FLAK.damage * (2 + unit.level() - 1)) / 2)
      : SHIP_ANTI_AIR.damage;
    plane.modifyHealth(-damage, unit.owner());
    if (!plane.isActive() || plane.health() <= 0) {
      if (plane.isActive()) plane.delete(true, unit.owner());
      return true;
    }
  }
  return false;
}

export class BomberExecution implements Execution {
  private mg: Game | null = null;
  private active = true;
  private bomber: Unit | null = null;
  private returning = false;
  private ticksFlown = 0;

  constructor(
    private player: Player,
    private base: TileRef,
    private target: TileRef,
    /** Power tier of the raid (Mk I-III). */
    private tier: WeaponTier = 1,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    if (this.bomber === null) {
      this.bomber = this.player.buildUnit(UnitType.Bomber, this.base, {
        targetTile: this.target,
      });
      return;
    }
    const bomber = this.bomber;
    if (!bomber.isActive()) {
      this.active = false;
      return;
    }
    this.ticksFlown++;
    if (this.ticksFlown % ANTI_AIR.volleyTicks === 0 && this.antiAirFire()) {
      return;
    }
    const spec = weaponAtTier(WEAPONS.airstrike, this.tier);
    const dest = this.returning ? this.base : this.target;
    for (let i = 0; i < BOMBER.speed; i++) {
      const next = stepToward(mg, bomber.tile(), dest);
      if (next !== bomber.tile()) bomber.move(next);
      if (!this.returning && chebyshev(mg, bomber.tile(), this.target) <= 2) {
        this.dropBombs(ticks);
        this.returning = true;
        break;
      }
      if (this.returning && bomber.tile() === this.base) {
        bomber.setReachedTarget();
        bomber.delete(false);
        this.active = false;
        return;
      }
    }
    void spec;
  }

  /** Enemy SAMs in range fire; returns true when the bomber was shot down. */
  private antiAirFire(): boolean {
    if (antiAirFire(this.mg!, this.bomber!, this.player)) {
      this.active = false;
      return true;
    }
    return false;
  }

  private dropBombs(ticks: number): void {
    const mg = this.mg!;
    const spec = weaponAtTier(WEAPONS.airstrike, this.tier);
    const rand = new PseudoRandom(ticks * 7_919 + this.target);
    const tx = mg.x(this.target);
    const ty = mg.y(this.target);
    // Tech: Heavy Bombers.
    const shots =
      spec.shots +
      (this.player.hasTech("heavy_bombers")
        ? TECH_EFFECTS.heavyBomberExtraShots
        : 0);
    for (let i = 0; i < shots; i++) {
      let dst = this.target;
      if (i > 0) {
        const x = Math.max(
          0,
          Math.min(
            mg.width() - 1,
            tx + rand.nextInt(-spec.spread, spec.spread + 1),
          ),
        );
        const y = Math.max(
          0,
          Math.min(
            mg.height() - 1,
            ty + rand.nextInt(-spec.spread, spec.spread + 1),
          ),
        );
        dst = mg.ref(x, y);
      }
      mg.addExecution(
        new ProjectileExecution(
          this.player,
          "airstrike",
          this.bomber!.tile(),
          dst,
          i * spec.shotInterval,
          this.tier,
        ),
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BomberSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      player: w.player(this.player),
      base: this.base,
      target: this.target,
      bomber: w.unitOrNull(this.bomber),
      returning: this.returning,
      ticksFlown: this.ticksFlown,
      tier: this.tier,
    });
  }

  restoreSnapshot(s: BomberState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.player = r.player(s.player);
    this.base = s.base;
    this.target = s.target;
    this.bomber = r.unitOrNull(s.bomber);
    this.returning = s.returning;
    this.ticksFlown = s.ticksFlown;
    this.tier = (s.tier ?? 1) as WeaponTier;
  }
}

const BomberStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  base: zTile(),
  target: zTile(),
  bomber: zRef().nullable(),
  returning: z.boolean(),
  ticksFlown: zInt(),
  // Optional: older snapshots were all Mk I.
  tier: zInt().optional(),
});
type BomberState = z.infer<typeof BomberStateSchema>;

export const BomberSnapshot = execSnapshotType({
  name: "Bomber",
  version: 1,
  schema: BomberStateSchema,
  cls: () => BomberExecution,
});

export class FighterExecution implements Execution {
  private mg: Game | null = null;
  private active = true;
  private fighter: Unit | null = null;
  private returning = false;
  private ticksFlown = 0;

  constructor(
    private player: Player,
    private base: TileRef,
    private target: Unit,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    const mg = this.mg!;
    if (this.fighter === null) {
      this.fighter = this.player.buildUnit(UnitType.Fighter, this.base, {
        targetUnit: this.target,
      });
      return;
    }
    const f = this.fighter;
    if (!f.isActive()) {
      this.active = false;
      return;
    }
    this.ticksFlown++;
    if (
      !this.returning &&
      (!this.target.isActive() || this.ticksFlown > FIGHTER.maxFlightTicks)
    ) {
      this.returning = true;
    }
    for (let i = 0; i < FIGHTER.speed; i++) {
      const dest = this.returning ? this.base : this.target.tile();
      const next = stepToward(mg, f.tile(), dest);
      if (next !== f.tile()) f.move(next);
      if (!this.returning && chebyshev(mg, f.tile(), this.target.tile()) <= 1) {
        this.attack();
        this.returning = true;
      }
      if (this.returning && f.tile() === this.base) {
        f.setReachedTarget();
        f.delete(false);
        this.active = false;
        return;
      }
    }
  }

  private attack(): void {
    const t = this.target;
    if (!t.isActive()) return;
    // Tech: Interceptors.
    const damage = this.player.hasTech("interceptors")
      ? Math.floor(
          (FIGHTER.damage * TECH_EFFECTS.interceptorDamagePercent) / 100,
        )
      : FIGHTER.damage;
    t.modifyHealth(-damage, this.player);
    if (t.isActive() && t.health() <= 0) t.delete(true, this.player);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FighterSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      player: w.player(this.player),
      base: this.base,
      target: w.unit(this.target),
      fighter: w.unitOrNull(this.fighter),
      returning: this.returning,
      ticksFlown: this.ticksFlown,
    });
  }

  restoreSnapshot(s: FighterState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.player = r.player(s.player);
    this.base = s.base;
    this.target = r.unit(s.target);
    this.fighter = r.unitOrNull(s.fighter);
    this.returning = s.returning;
    this.ticksFlown = s.ticksFlown;
  }
}

const FighterStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  base: zTile(),
  target: zRef(),
  fighter: zRef().nullable(),
  returning: z.boolean(),
  ticksFlown: zInt(),
});
type FighterState = z.infer<typeof FighterStateSchema>;

export const FighterSnapshot = execSnapshotType({
  name: "Fighter",
  version: 1,
  schema: FighterStateSchema,
  cls: () => FighterExecution,
});

export class AirbaseExecution implements Execution {
  private mg: Game | null = null;
  private active = true;
  private lastScramble = -1_000_000;
  /** Bombers a fighter from this base is already chasing. */
  private chased = new Set<Unit>();

  constructor(private airbase: Unit) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    const base = this.airbase;
    if (!base.isActive()) {
      this.active = false;
      return;
    }
    if (base.isUnderConstruction()) return;
    if (mg.unitCount(UnitType.Bomber) === 0) return;
    if (ticks - this.lastScramble < FIGHTER.reloadTicks) return;
    for (const b of this.chased) if (!b.isActive()) this.chased.delete(b);
    const owner = base.owner();
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const { unit, distSquared } of mg.nearbyUnits(
      base.tile(),
      FIGHTER.interceptRange,
      [UnitType.Bomber],
    )) {
      if (!hostile(owner, unit.owner()) || this.chased.has(unit)) continue;
      if (
        distSquared < bestD ||
        (distSquared === bestD && unit.id() < best!.id())
      ) {
        best = unit;
        bestD = distSquared;
      }
    }
    if (best === null) return;
    this.lastScramble = ticks;
    this.chased.add(best);
    mg.addExecution(new FighterExecution(owner, base.tile(), best));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirbaseSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      airbase: w.unit(this.airbase),
      lastScramble: this.lastScramble,
      chased: [...this.chased].map((u) => w.unit(u)),
    });
  }

  restoreSnapshot(s: AirbaseState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.airbase = r.unit(s.airbase);
    this.lastScramble = s.lastScramble;
    this.chased = new Set(s.chased.map((i) => r.unit(i)));
  }
}

const AirbaseStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  airbase: zRef(),
  lastScramble: zInt(),
  /** In insertion order. */
  chased: z.array(zRef()),
});
type AirbaseState = z.infer<typeof AirbaseStateSchema>;

export const AirbaseSnapshot = execSnapshotType({
  name: "Airbase",
  version: 1,
  schema: AirbaseStateSchema,
  cls: () => AirbaseExecution,
});
