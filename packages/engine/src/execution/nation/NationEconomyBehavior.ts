/**
 * NationEconomyBehavior — AI nations build income buildings and airbases.
 *
 * - Gold Mine on its highland/mountain land, Market anywhere, Oil Rig off
 *   its coast: when gold is plentiful, up to a few of each.
 * - One Airbase (two when at war) once rich enough.
 *
 * Never on Easy. Stateless, own PseudoRandom (tick + nation) so it never
 * shifts the nation's main random sequence.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import { Difficulty, UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";

const LIMITS: Partial<Record<UnitType, number>> = {
  [UnitType.GoldMine]: 3,
  [UnitType.Market]: 3,
  [UnitType.OilRig]: 2,
  [UnitType.Airbase]: 1,
  [UnitType.RadarStation]: 1,
  [UnitType.FlakGun]: 2,
};

export class NationEconomyBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /** Call on the nation's decision ticks. Returns the type built, if any. */
  maybeBuild(): UnitType | null {
    const cfg = this.mg.config();
    if (cfg.gameConfig().difficulty === Difficulty.Easy) return null;
    const rand = new PseudoRandom(
      this.mg.ticks() * 3_571 + this.player.smallID() * 65_537,
    );
    if (!rand.chance(4)) return null;
    const atWar =
      this.player.outgoingAttacks().some((a) => a.target().isPlayer()) ||
      this.player.incomingAttacks().length > 0;
    const order: UnitType[] = atWar
      ? [
          UnitType.Airbase,
          UnitType.FlakGun,
          UnitType.RadarStation,
          UnitType.GoldMine,
          UnitType.OilRig,
          UnitType.Market,
        ]
      : [UnitType.GoldMine, UnitType.OilRig, UnitType.Market, UnitType.Airbase];
    for (const type of order) {
      if (cfg.isUnitDisabled(type)) continue;
      const limit =
        (LIMITS[type] ?? 0) + (atWar && type === UnitType.Airbase ? 1 : 0);
      if (this.player.units(type).length >= limit) continue;
      const cost = this.mg.unitInfo(type).cost(this.mg, this.player);
      if (this.player.gold() < cost * 3n) continue;
      const tile = this.site(type, rand);
      if (tile === null) continue;
      this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
      return type;
    }
    return null;
  }

  /** A tile where `type` can go, sampled near the nation's own land. */
  private site(type: UnitType, rand: PseudoRandom): TileRef | null {
    const border = [...this.player.borderTiles()];
    if (border.length === 0) return null;
    for (let i = 0; i < 12; i++) {
      const seed = border[rand.nextInt(0, border.length)];
      let t = seed;
      if (type === UnitType.OilRig) {
        // Look a few tiles offshore from a coastal border tile.
        const x = this.mg.x(seed) + rand.nextInt(-5, 6);
        const y = this.mg.y(seed) + rand.nextInt(-5, 6);
        if (!this.mg.isValidCoord(x, y)) continue;
        t = this.mg.ref(x, y);
      }
      const spawn = this.player.canBuild(type, t);
      if (spawn !== false) return spawn;
    }
    return null;
  }
}
