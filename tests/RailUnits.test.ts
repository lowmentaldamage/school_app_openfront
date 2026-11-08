import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TrainType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import { EXPRESS_TRAIN } from "@laukolaroser/engine-lib/rail/RailUnits";
import { AttackExecution } from "@laukolaroser/engine/execution/AttackExecution";
import { FactoryExecution } from "@laukolaroser/engine/execution/FactoryExecution";
import { NationRailBehavior } from "@laukolaroser/engine/execution/nation/NationRailBehavior";
import { Game, Player, Unit } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const MAP = "plains"; // 100x100, all land

let game: Game;
let a: Player;
let b: Player;

function build(p: Player, type: UnitType, x: number, y: number): Unit {
  const spawn = p.canBuild(type, game.ref(x, y));
  if (spawn === false) throw new Error(`cannot build ${type} at ${x},${y}`);
  return p.buildUnit(type, spawn, {});
}

/** a owns the west 3/4 with a factory and three cities joined by rails. */
async function railGame(difficulty = Difficulty.Medium): Promise<void> {
  game = await setup(MAP, { instantBuild: true, difficulty }, [
    new PlayerInfo("a", PlayerType.Human, "a", "a"),
    new PlayerInfo("b", PlayerType.Human, "b", "b"),
  ]);
  a = game.player("a");
  b = game.player("b");
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      (x < 76 ? a : b).conquer(game.ref(x, y));
    }
  }
  a.addGold(100_000_000n);
  b.addGold(100_000_000n);
  build(a, UnitType.City, 30, 50);
  build(a, UnitType.City, 66, 50);
  build(a, UnitType.City, 48, 30);
  const factory = build(a, UnitType.Factory, 48, 50);
  game.addExecution(new FactoryExecution(factory));
  executeTicks(game, 20);
}

describe("military trains (removed)", () => {
  test("armored trains, troop trains and rail SAMs can no longer be built", async () => {
    await railGame(Difficulty.Hard);
    for (const type of [
      UnitType.ArmoredTrain,
      UnitType.TroopTrain,
      UnitType.RailSAM,
    ]) {
      expect(game.config().isUnitDisabled(type)).toBe(true);
      for (const t of a.tiles()) {
        expect(a.canBuild(type, t)).toBe(false);
        break;
      }
    }
  });
});

describe("express cargo trains", () => {
  test("appear once the owner has a level 2 factory, faster and shorter", async () => {
    await railGame();
    const expressEngines = () =>
      game
        .units(UnitType.Train)
        .filter(
          (u) => u.trainType() === TrainType.Engine && u.isLoaded() === true,
        );
    let seen = 0;
    for (let i = 0; i < 600; i++) {
      game.executeNextTick();
      seen += expressEngines().length;
    }
    expect(seen).toBe(0);

    const factory = a.units(UnitType.Factory)[0];
    factory.increaseLevel();
    let found = false;
    for (let i = 0; i < 3000 && !found; i++) {
      game.executeNextTick();
      found = expressEngines().length > 0;
    }
    expect(found).toBe(true);
    expect(EXPRESS_TRAIN.speed).toBeGreaterThan(2);
  });
});

describe("NationRailBehavior", () => {
  test("never builds military trains (removed from the game)", async () => {
    await railGame(Difficulty.Hard);
    a.addTroops(300_000);
    b.addTroops(800_000);
    const ai = new NationRailBehavior(game, a);
    game.addExecution(new AttackExecution(20_000, a, b.id()));
    for (let i = 0; i < 600; i++) {
      if (i % 10 === 0) ai.maybeBuild();
      game.executeNextTick();
    }
    expect(a.units(UnitType.ArmoredTrain)).toHaveLength(0);
    expect(a.units(UnitType.TroopTrain)).toHaveLength(0);
  });
});
