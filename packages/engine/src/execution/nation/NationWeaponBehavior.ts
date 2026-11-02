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
import { Difficulty } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  WEAPONS,
  type WeaponId,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { Game, Player } from "../../game/Game";
import { launcherReady, WeaponStrikeExecution } from "../WeaponStrikeExecution";

/** Order of preference, and how many strikes' worth of gold to keep. */
const PLAN: readonly { weapon: WeaponId; reserve: bigint }[] = [
  { weapon: "rocket", reserve: 6n },
  { weapon: "artillery", reserve: 4n },
  { weapon: "naval", reserve: 4n },
];

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

    for (const { weapon, reserve } of PLAN) {
      const spec = WEAPONS[weapon];
      if (this.mg.config().isUnitDisabled(spec.launcher)) continue;
      if (this.player.gold() < spec.cost * reserve) continue;
      let tried = 0;
      for (const launcher of this.player.units(spec.launcher)) {
        if (tried >= MAX_LAUNCHERS_TRIED) break;
        if (!launcherReady(this.mg, launcher, spec)) continue;
        tried++;
        const target = this.findTarget(
          launcher.tile(),
          spec.range,
          enemies,
          rand,
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
  private findTarget(
    from: TileRef,
    range: number,
    enemies: Set<Player>,
    rand: PseudoRandom,
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
      if (owner.isPlayer() && enemies.has(owner)) return tile;
    }
    return null;
  }
}
