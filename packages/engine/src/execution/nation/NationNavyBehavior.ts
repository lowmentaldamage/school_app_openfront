/**
 * NationNavyBehavior — AI nations build destroyers and battleships.
 *
 * - Destroyers: escorts once the nation already runs a warship and has gold
 *   to spare; at most one per port, four in total.
 * - Battleships: only while fighting a land war, when rich, at most two.
 * - Submarines (≤ 2) once it runs a warship; one carrier during a war.
 *
 * Never on Easy. Stateless, with its own PseudoRandom seeded from the tick
 * and the nation, so it never shifts the nation's main random sequence.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import { Difficulty, UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";

const MAX_DESTROYERS = 4;
const MAX_BATTLESHIPS = 2;
const MAX_SUBMARINES = 2;
const MAX_CARRIERS = 1;

export class NationNavyBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /** Call on the nation's decision ticks. Returns the type built, if any. */
  maybeBuild(): UnitType | null {
    const cfg = this.mg.config();
    if (cfg.gameConfig().difficulty === Difficulty.Easy) return null;
    const ports = this.player.units(UnitType.Port);
    if (ports.length === 0) return null;
    const rand = new PseudoRandom(
      this.mg.ticks() * 6_151 + this.player.smallID() * 92_821,
    );
    if (!rand.chance(4)) return null;

    const gold = this.player.gold();
    const atWar =
      this.player.outgoingAttacks().some((a) => a.target().isPlayer()) ||
      this.player.incomingAttacks().length > 0;

    if (
      atWar &&
      !cfg.isUnitDisabled(UnitType.Battleship) &&
      this.player.units(UnitType.Battleship).length < MAX_BATTLESHIPS &&
      gold > this.cost(UnitType.Battleship) * 2n
    ) {
      if (this.build(UnitType.Battleship, ports[0].tile(), rand)) {
        return UnitType.Battleship;
      }
    }

    if (
      !cfg.isUnitDisabled(UnitType.Destroyer) &&
      this.player.units(UnitType.Warship).length > 0 &&
      this.player.units(UnitType.Destroyer).length <
        Math.min(MAX_DESTROYERS, ports.length) &&
      gold > this.cost(UnitType.Destroyer) * 4n
    ) {
      const port = ports[rand.nextInt(0, ports.length)];
      if (this.build(UnitType.Destroyer, port.tile(), rand)) {
        return UnitType.Destroyer;
      }
    }

    // Submarines raid enemy shipping; a carrier backs a war at sea.
    if (
      !cfg.isUnitDisabled(UnitType.Submarine) &&
      this.player.units(UnitType.Warship).length > 0 &&
      this.player.units(UnitType.Submarine).length < MAX_SUBMARINES &&
      gold > this.cost(UnitType.Submarine) * 4n
    ) {
      const port = ports[rand.nextInt(0, ports.length)];
      if (this.build(UnitType.Submarine, port.tile(), rand)) {
        return UnitType.Submarine;
      }
    }
    if (
      atWar &&
      !cfg.isUnitDisabled(UnitType.Carrier) &&
      this.player.units(UnitType.Carrier).length < MAX_CARRIERS &&
      gold > this.cost(UnitType.Carrier) * 2n
    ) {
      if (this.build(UnitType.Carrier, ports[0].tile(), rand)) {
        return UnitType.Carrier;
      }
    }
    return null;
  }

  private cost(type: UnitType): bigint {
    return this.mg.unitInfo(type).cost(this.mg, this.player);
  }

  private build(
    type: UnitType,
    portTile: TileRef,
    rand: PseudoRandom,
  ): boolean {
    const tile = this.waterNear(portTile, 60, rand);
    if (tile === null) return false;
    if (this.player.canBuild(type, tile) === false) return false;
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  private waterNear(
    portTile: TileRef,
    radius: number,
    rand: PseudoRandom,
  ): TileRef | null {
    const px = this.mg.x(portTile);
    const py = this.mg.y(portTile);
    for (let i = 0; i < 30; i++) {
      // Shrinking search: half the samples close to the port.
      const r = i < 15 ? Math.ceil(radius / 4) : radius;
      const x = Math.max(
        0,
        Math.min(this.mg.width() - 1, px + rand.nextInt(-r, r + 1)),
      );
      const y = Math.max(
        0,
        Math.min(this.mg.height() - 1, py + rand.nextInt(-r, r + 1)),
      );
      const t = this.mg.ref(x, y);
      if (this.mg.isWater(t)) return t;
    }
    return null;
  }
}
