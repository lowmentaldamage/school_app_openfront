/**
 * NationDefenseBehavior — AI nations build defense extras:
 *  - a Fort on the border while under attack (up to 2),
 *  - a Coastal Battery once they have a port and an enemy has warships
 *    (1, 2 at war),
 *  - Sea Mines off their coast during a war (up to 4).
 *
 * Never on Easy. Stateless, with its own PseudoRandom seeded from the tick
 * and the nation, so it never shifts the nation's main random sequence.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import { Difficulty, UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";

export class NationDefenseBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /** Call on the nation's decision ticks. Returns the type built, if any. */
  maybeBuild(): UnitType | null {
    const cfg = this.mg.config();
    if (cfg.gameConfig().difficulty === Difficulty.Easy) return null;
    const rand = new PseudoRandom(
      this.mg.ticks() * 7_013 + this.player.smallID() * 48_271,
    );
    if (!rand.chance(4)) return null;
    const p = this.player;
    const underAttack = p.incomingAttacks().length > 0;
    const atWar =
      underAttack || p.outgoingAttacks().some((a) => a.target().isPlayer());
    const gold = p.gold();
    const cost = (t: UnitType) => this.mg.unitInfo(t).cost(this.mg, p);
    const ok = (t: UnitType, limit: number, mult: bigint) =>
      !cfg.isUnitDisabled(t) &&
      p.units(t).length < limit &&
      gold > cost(t) * mult;

    if (underAttack && ok(UnitType.Fort, 2, 3n)) {
      const t = this.site(UnitType.Fort, rand, false);
      if (t !== null) return this.build(UnitType.Fort, t);
    }
    if (p.units(UnitType.Port).length > 0) {
      if (ok(UnitType.CoastalBattery, atWar ? 2 : 1, 4n) && this.enemyNavy()) {
        const t = this.site(UnitType.CoastalBattery, rand, false);
        if (t !== null) return this.build(UnitType.CoastalBattery, t);
      }
      if (atWar && ok(UnitType.SeaMine, 4, 10n)) {
        const t = this.site(UnitType.SeaMine, rand, true);
        if (t !== null) return this.build(UnitType.SeaMine, t);
      }
    }
    return null;
  }

  private enemyNavy(): boolean {
    for (const s of this.mg.units(
      UnitType.Warship,
      UnitType.Destroyer,
      UnitType.Battleship,
    )) {
      if (s.owner() !== this.player && !this.player.isFriendly(s.owner())) {
        return true;
      }
    }
    return false;
  }

  private build(type: UnitType, tile: TileRef): UnitType {
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    return type;
  }

  /** A tile for `type`: on a border tile, or a few tiles offshore. */
  private site(
    type: UnitType,
    rand: PseudoRandom,
    offshore: boolean,
  ): TileRef | null {
    const border = [...this.player.borderTiles()];
    if (border.length === 0) return null;
    for (let i = 0; i < 12; i++) {
      let t = border[rand.nextInt(0, border.length)];
      // Offshore for mines; otherwise a few tiles behind the front line.
      const reach = offshore ? 6 : 5;
      const x = this.mg.x(t) + rand.nextInt(-reach, reach + 1);
      const y = this.mg.y(t) + rand.nextInt(-reach, reach + 1);
      if (!this.mg.isValidCoord(x, y)) continue;
      const moved = this.mg.ref(x, y);
      if (offshore || this.mg.owner(moved) === this.player) t = moved;
      const spawn = this.player.canBuild(type, t);
      if (spawn !== false) return spawn;
    }
    return null;
  }
}
