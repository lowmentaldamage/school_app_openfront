/**
 * NationWeaponBehavior — AI nations fly rocket bomber runs in wars.
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
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  airbaseReady,
  bomberCooldown,
  ROCKET_BOMBER,
} from "@laukolaroser/engine-lib/air/RocketBomber";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  lineOfFireBlocked,
  type WeaponId,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { Game, Player } from "../../game/Game";
import { RocketBomberExecution } from "../RocketBomberExecution";

/** Nations keep this many runs' worth of gold before flying one. */
const BOMBER_RESERVE = 4n;

const SAMPLES_PER_LAUNCHER = 12;

export class NationWeaponBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /**
   * Call on the nation's decision ticks: in a war, a nation with a ready
   * Airbase and gold to spare flies a rocket bomber run over the enemy
   * (its buildings first, else its border), the line continuing past the
   * target away from the airbase.
   */
  maybeFire(): void {
    if (this.mg.config().gameConfig().difficulty === Difficulty.Easy) return;
    if (this.mg.config().isUnitDisabled(UnitType.Airbase)) return;
    const cost = this.mg.config().strikeCost(ROCKET_BOMBER.cost, this.player);
    if (this.player.gold() < cost * BOMBER_RESERVE) return;
    const enemies = this.enemiesAtWar();
    if (enemies.size === 0) return;
    const rand = new PseudoRandom(
      this.mg.ticks() * 7_919 + this.player.smallID() * 104_729,
    );
    for (const base of this.player.units(UnitType.Airbase)) {
      if (base.isUnderConstruction()) continue;
      if (
        !airbaseReady(
          base.missileTimerQueue(),
          this.mg.ticks(),
          bomberCooldown(this.player.hasTech("jet_engines")),
        )
      ) {
        continue;
      }
      const target = this.raidTarget(
        base.tile(),
        ROCKET_BOMBER.range,
        enemies,
        rand,
      );
      if (target === null) return;
      const mg = this.mg;
      const dx = mg.x(target) - mg.x(base.tile());
      const dy = mg.y(target) - mg.y(base.tile());
      const len = Math.max(1, Math.abs(dx) + Math.abs(dy));
      const ex = Math.max(
        0,
        Math.min(mg.width() - 1, mg.x(target) + Math.trunc((dx * 30) / len)),
      );
      const ey = Math.max(
        0,
        Math.min(mg.height() - 1, mg.y(target) + Math.trunc((dy * 30) / len)),
      );
      mg.addExecution(
        new RocketBomberExecution(this.player, target, mg.ref(ex, ey)),
      );
      return;
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
