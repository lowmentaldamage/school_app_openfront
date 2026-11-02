import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TrainType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  EXPRESS_TRAIN,
  RAIL_UNITS,
} from "@laukolaroser/engine-lib/rail/RailUnits";
import { AttackExecution } from "@laukolaroser/engine/execution/AttackExecution";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { FactoryExecution } from "@laukolaroser/engine/execution/FactoryExecution";
import { NationRailBehavior } from "@laukolaroser/engine/execution/nation/NationRailBehavior";
import { NukeExecution } from "@laukolaroser/engine/execution/NukeExecution";
import { Game, Player, Unit } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "plains"; // 100x100, all land

let game: Game;
let a: Player;
let b: Player;

function conquerDisc(p: Player, cx: number, cy: number, r: number) {
  for (let y = Math.max(0, cy - r); y <= Math.min(99, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(99, cx + r); x++) {
      p.conquer(game.ref(x, y));
    }
  }
}

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

function railUnit(type: UnitType, x = 48, y = 50): Unit {
  game.addExecution(new ConstructionExecution(a, type, game.ref(x, y)));
  executeTicks(game, 3);
  const units = a.units(type);
  expect(units.length).toBeGreaterThan(0);
  return units[units.length - 1];
}

describe("military trains", () => {
  beforeEach(() => railGame());

  test("start at an own station and ride the rails between stations", () => {
    const train = railUnit(UnitType.ArmoredTrain);
    expect(train.health()).toBe(RAIL_UNITS[UnitType.ArmoredTrain].maxHealth);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      seen.add(train.tile());
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(train.isActive()).toBe(true);
  });

  test("cannot be built away from a station with rails", () => {
    conquerDisc(b, 95, 95, 4);
    expect(b.canBuild(UnitType.ArmoredTrain, game.ref(95, 95))).toBe(false);
    expect(a.canBuild(UnitType.ArmoredTrain, game.ref(48, 52))).not.toBe(false);
  });

  test("troop trains deliver reinforcements at cities", () => {
    railUnit(UnitType.TroopTrain);
    a.removeTroops(a.troops());
    const before = a.troops();
    executeTicks(game, 300);
    expect(a.troops()).toBeGreaterThan(before);
  });

  test("armored trains shell enemy land only during a land war", () => {
    railUnit(UnitType.ArmoredTrain, 66, 50);
    a.addTroops(200_000);
    b.addTroops(500_000);
    const shells = () =>
      game.units(UnitType.ArtilleryShell).filter((u) => u.owner() === a).length;
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      seen = Math.max(seen, shells());
    }
    expect(seen).toBe(0);
    game.addExecution(new AttackExecution(20_000, a, b.id()));
    for (let i = 0; i < 400 && seen === 0; i++) {
      game.executeNextTick();
      seen = Math.max(seen, shells());
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("rail SAMs shoot down enemy nukes flying nearby", () => {
    railUnit(UnitType.RailSAM, 66, 50);
    build(b, UnitType.MissileSilo, 90, 50);
    executeTicks(game, 2);
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, b, game.ref(55, 50), null),
    );
    let sawSamMissile = false;
    let landed = false;
    const nukesBefore = game.units(UnitType.AtomBomb).length;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      if (game.units(UnitType.SAMMissile).some((m) => m.owner() === a)) {
        sawSamMissile = true;
      }
      if (
        game.units(UnitType.AtomBomb).length === nukesBefore &&
        i > 5 &&
        sawSamMissile
      ) {
        landed = true;
        break;
      }
    }
    expect(sawSamMissile).toBe(true);
    expect(landed).toBe(true);
    const intercepts = game.stats().getPlayerStats(a)?.bombs?.abomb?.[2] ?? 0n;
    expect(intercepts).toBe(1n);
  });

  test("snapshot round trip with military trains running", async () => {
    railUnit(UnitType.ArmoredTrain);
    railUnit(UnitType.TroopTrain, 30, 50);
    railUnit(UnitType.RailSAM, 66, 50);
    executeTicks(game, 15);
    await expectSnapshotRoundTrip(game, MAP, 30);
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
  test("builds armored and troop trains only while at war", async () => {
    await railGame(Difficulty.Hard);
    a.addTroops(300_000);
    b.addTroops(800_000);
    const ai = new NationRailBehavior(game, a);
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        if (i % 10 === 0) ai.maybeBuild();
        game.executeNextTick();
      }
    };
    run(400);
    expect(a.units(UnitType.ArmoredTrain)).toHaveLength(0);
    game.addExecution(new AttackExecution(20_000, a, b.id()));
    run(600);
    expect(a.units(UnitType.ArmoredTrain).length).toBeGreaterThan(0);
    expect(a.units(UnitType.ArmoredTrain).length).toBeLessThanOrEqual(2);
  });
});
