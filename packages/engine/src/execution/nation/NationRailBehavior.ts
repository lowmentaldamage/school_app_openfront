/**
 * NationRailBehavior — AI nations build military trains.
 *
 * - Armored Train (≤ 2) and Troop Train (≤ 1) while fighting a land war.
 * - Rail SAM (≤ 2) once a non-friendly player owns a missile silo.
 *
 * Needs a station with railroads. Never on Easy. Stateless, with its own
 * PseudoRandom seeded from the tick and the nation, so it never shifts the
 * nation's main random sequence.
 */

import { Difficulty, UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";

const LIMITS: Partial<Record<UnitType, number>> = {
  [UnitType.ArmoredTrain]: 2,
  [UnitType.TroopTrain]: 1,
  [UnitType.RailSAM]: 2,
};

export class NationRailBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /** Call on the nation's decision ticks. Returns the type built, if any. */
  maybeBuild(): UnitType | null {
    const cfg = this.mg.config();
    if (cfg.gameConfig().difficulty === Difficulty.Easy) return null;
    const rand = new PseudoRandom(
      this.mg.ticks() * 4_909 + this.player.smallID() * 77_591,
    );
    if (!rand.chance(5)) return null;

    const atWar =
      this.player.outgoingAttacks().some((a) => a.target().isPlayer()) ||
      this.player.incomingAttacks().length > 0;
    const nukeThreat = this.mg
      .players()
      .some(
        (p) =>
          p !== this.player &&
          !this.player.isFriendly(p) &&
          p.units(UnitType.MissileSilo).length > 0,
      );

    const wants: UnitType[] = [];
    if (atWar) wants.push(UnitType.ArmoredTrain, UnitType.TroopTrain);
    if (nukeThreat) wants.push(UnitType.RailSAM);
    for (const type of wants) {
      if (cfg.isUnitDisabled(type)) continue;
      if (this.player.units(type).length >= (LIMITS[type] ?? 0)) continue;
      const cost = this.mg.unitInfo(type).cost(this.mg, this.player);
      if (this.player.gold() < cost * 3n) continue;
      const stations = this.player
        .units(UnitType.City, UnitType.Port, UnitType.Factory)
        .filter((u) => this.player.canBuild(type, u.tile()) !== false);
      if (stations.length === 0) return null;
      const at = stations[rand.nextInt(0, stations.length)];
      this.mg.addExecution(
        new ConstructionExecution(this.player, type, at.tile()),
      );
      return type;
    }
    return null;
  }
}
