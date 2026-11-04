/**
 * NationWeaponBehavior — AI nations use weapon strikes in wars.
 *
 * Only against players they are actually fighting (an attack in either
 * direction), only when the strike is cheap relative to their treasury (so
 * nukes and buildings keep priority), and never on Easy. One strike per
 * decision tick at most.
 *
 * Uses its own PseudoRandom seeded from the tick and the nation, so it never
 * shifts the nation's main random sequence (other behaviors stay exactly as
 * they were).
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import {
  Difficulty,
  Structures,
} from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  launcherRange,
  lineOfFireBlocked,
  playerWeapon,
  WEAPONS,
  weaponUpgradeCost,
  type WeaponId,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { Game, Player } from "../../game/Game";
import { UpgradeWeaponExecution } from "../UpgradeWeaponExecution";
import { launcherReady, WeaponStrikeExecution } from "../WeaponStrikeExecution";

/** Order of preference, and how many strikes' worth of gold to keep. */
const PLAN: readonly { weapon: WeaponId; reserve: bigint }[] = [
  { weapon: "rocket", reserve: 6n },
  { weapon: "artillery", reserve: 4n },
  { weapon: "naval", reserve: 4n },
  { weapon: "airstrike", reserve: 5n },
];

/** Nations upgrade a weapon once they hold this many times its price. */
const UPGRADE_RESERVE = 4n;
const SAMPLES_PER_LAUNCHER = 12;
const MAX_LAUNCHERS_TRIED = 3;

export class NationWeaponBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /** Call on the nation's decision ticks. */
  maybeFire(): void {
    if (this.mg.config().gameConfig().difficulty === Difficulty.Easy) return;
    const enemies = this.enemiesAtWar();
    if (enemies.size === 0) return;
    const rand = new PseudoRandom(
      this.mg.ticks() * 7_919 + this.player.smallID() * 104_729,
    );

    // Rich nations buy power tiers for weapons they can fire.
    for (const { weapon } of PLAN) {
      const cost = weaponUpgradeCost(this.player.weaponTiers(), weapon);
      if (cost === null || this.player.gold() < cost * UPGRADE_RESERVE) {
        continue;
      }
      if (this.player.units(WEAPONS[weapon].launchers).length === 0) continue;
      this.mg.addExecution(new UpgradeWeaponExecution(this.player, weapon));
      return;
    }

    for (const { weapon, reserve } of PLAN) {
      const spec = playerWeapon(this.player, weapon);
      if (spec.launchers.every((t) => this.mg.config().isUnitDisabled(t))) {
        continue;
      }
      if (this.player.gold() < spec.cost * reserve) continue;
      let tried = 0;
      for (const launcher of this.player.units(spec.launchers)) {
        if (tried >= MAX_LAUNCHERS_TRIED) break;
        if (!launcherReady(this.mg, launcher, spec)) continue;
        tried++;
        const target =
          weapon === "airstrike"
            ? this.raidTarget(launcher.tile(), spec.range, enemies, rand)
            : this.findTarget(
                launcher.tile(),
                launcherRange(this.mg, spec, launcher.tile()),
                enemies,
                rand,
                weapon,
              );
        if (target !== null) {
          this.mg.addExecution(
            new WeaponStrikeExecution(this.player, weapon, target),
          );
          return;
        }
      }
    }
  }

  /** Players this nation is attacking or being attacked by. */
  private enemiesAtWar(): Set<Player> {
    const out = new Set<Player>();
    for (const a of this.player.outgoingAttacks()) {
      const t = a.target();
      if (t.isPlayer() && !this.player.isFriendly(t)) out.add(t);
    }
    for (const a of this.player.incomingAttacks()) {
      const t = a.attacker();
      if (!this.player.isFriendly(t)) out.add(t);
    }
    return out;
  }

  /** A random enemy-owned tile within range, sampled (cheap, bounded). */
  /**
   * Strategic bombing: an enemy building in range (cities and factories
   * first), else a random tile of the enemy's border in range.
   */
  private raidTarget(
    from: TileRef,
    range: number,
    enemies: Set<Player>,
    rand: PseudoRandom,
  ): TileRef | null {
    const r2 = range * range;
    const sorted = [...enemies].sort((a, b) => a.smallID() - b.smallID());
    for (const e of sorted) {
      const buildings = e
        .units(Structures.types)
        .filter(
          (u) =>
            u.isActive() && this.mg.euclideanDistSquared(u.tile(), from) <= r2,
        );
      if (buildings.length > 0) {
        return buildings[rand.nextInt(0, buildings.length)].tile();
      }
    }
    return this.findTarget(from, range, enemies, rand);
  }

  private findTarget(
    from: TileRef,
    range: number,
    enemies: Set<Player>,
    rand: PseudoRandom,
    weapon: WeaponId = "airstrike",
  ): TileRef | null {
    const fx = this.mg.x(from);
    const fy = this.mg.y(from);
    for (let i = 0; i < SAMPLES_PER_LAUNCHER; i++) {
      const dx = rand.nextInt(-range, range + 1);
      const dy = rand.nextInt(-range, range + 1);
      if (dx * dx + dy * dy > range * range) continue;
      const x = fx + dx;
      const y = fy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const tile = this.mg.ref(x, y);
      const owner = this.mg.owner(tile);
      if (!owner.isPlayer() || !enemies.has(owner)) continue;
      // No shots into a mountain wall.
      if (lineOfFireBlocked(this.mg, from, tile, weapon)) continue;
      return tile;
    }
    return null;
  }
}
