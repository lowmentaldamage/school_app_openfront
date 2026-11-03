import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import { BOMBER } from "@laukolaroser/engine-lib/air/Air";
import {
  ECONOMY_BUILDINGS,
  incomePerInterval,
  MOUNTAIN_MINE_BONUS_PERCENT,
} from "@laukolaroser/engine-lib/economy/Economy";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { IncomeBuildingExecution } from "@laukolaroser/engine/execution/IncomeBuildingExecution";
import { NationEconomyBehavior } from "@laukolaroser/engine/execution/nation/NationEconomyBehavior";
import { WeaponStrikeExecution } from "@laukolaroser/engine/execution/WeaponStrikeExecution";
import { Game, Player, Unit } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

function conquerRect(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
  }
}

function build(game: Game, p: Player, type: UnitType, x: number, y: number) {
  game.addExecution(new ConstructionExecution(p, type, game.ref(x, y)));
  executeTicks(game, 3);
  const all = p.units(type);
  return all[all.length - 1] as Unit | undefined;
}

describe("income buildings", () => {
  it("a market pays its owner every interval", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
    ]);
    const a = game.player("a");
    conquerRect(game, a, 0, 0, 100, 100);
    a.addGold(10_000_000n);
    const market = build(game, a, UnitType.Market, 50, 50);
    expect(market).toBeDefined();
    const before = a.gold();
    executeTicks(game, 100);
    const per = incomePerInterval(ECONOMY_BUILDINGS[UnitType.Market], 1);
    const gained = a.gold() - before;
    expect(gained).toBeGreaterThanOrEqual(per * 9n);
    expect(gained).toBeLessThanOrEqual(per * 11n);
  });

  it("gold mines need highland or mountain land", async () => {
    const plains = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
    ]);
    const pa = plains.player("a");
    conquerRect(plains, pa, 0, 0, 100, 100);
    pa.addGold(10_000_000n);
    expect(pa.canBuild(UnitType.GoldMine, plains.ref(50, 50))).toBe(false);

    const world = await setup("world", { instantBuild: true }, [
      new PlayerInfo("b", PlayerType.Human, "b", "b"),
    ]);
    const b = world.player("b");
    b.addGold(10_000_000n);
    // Find a mountain and claim the land around it.
    let mx = -1;
    let my = -1;
    for (let y = 100; y < 900 && mx < 0; y += 7) {
      for (let x = 100; x < 1900; x += 7) {
        if (world.terrainType(world.ref(x, y)) === TerrainType.Mountain) {
          mx = x;
          my = y;
          break;
        }
      }
    }
    expect(mx).toBeGreaterThan(0);
    conquerRect(world, b, mx - 6, my - 6, mx + 7, my + 7);
    const spawn = b.canBuild(UnitType.GoldMine, world.ref(mx, my));
    expect(spawn).not.toBe(false);
    const t = world.terrainType(spawn as number);
    expect([TerrainType.Highland, TerrainType.Mountain]).toContain(t);
  });

  it("a gold mine on a true mountain earns 50% more than on highland", async () => {
    const world = await setup("world", { instantBuild: true }, [
      new PlayerInfo("b", PlayerType.Human, "b", "b"),
    ]);
    const b = world.player("b");
    const find = (t: TerrainType) => {
      for (let y = 100; y < 900; y += 3)
        for (let x = 100; x < 1900; x += 3) {
          const r = world.ref(x, y);
          if (world.terrainType(r) === t && !world.isImpassable(r)) return r;
        }
      throw new Error("no tile");
    };
    const pay = (tile: number) => {
      b.conquer(tile);
      const mine = b.buildUnit(UnitType.GoldMine, tile, {});
      world.addExecution(new IncomeBuildingExecution(mine));
      executeTicks(world, 2);
      const g = b.gold();
      executeTicks(world, 100);
      const earned = b.gold() - g;
      mine.delete(false);
      return earned;
    };
    const workers = () => {
      const g = b.gold();
      executeTicks(world, 100);
      return b.gold() - g;
    };
    const base = workers();
    const high = pay(find(TerrainType.Highland)) - base;
    const mountain = pay(find(TerrainType.Mountain)) - base;
    expect(high).toBeGreaterThan(0n);
    expect(mountain).toBeGreaterThan(high);
    expect(Number(mountain) / Number(high)).toBeCloseTo(
      MOUNTAIN_MINE_BONUS_PERCENT / 100,
      1,
    );
  });

  it("oil rigs stand offshore near your land and are lost with it", async () => {
    const game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
    ]);
    const a = game.player("a");
    a.addGold(10_000_000n);
    // No land yet: nowhere to build.
    expect(a.canBuild(UnitType.OilRig, game.ref(12, 8))).toBe(false);
    conquerRect(game, a, 0, 0, 8, 16);
    expect(a.canBuild(UnitType.OilRig, game.ref(12, 8))).not.toBe(false);
    expect(a.canBuild(UnitType.OilRig, game.ref(3, 8))).toBe(false); // land
    const rig = build(game, a, UnitType.OilRig, 12, 8);
    expect(rig).toBeDefined();
    const before = a.gold();
    executeTicks(game, 30);
    expect(a.gold()).toBeGreaterThan(before);
    // Lose the coast: the rig goes too.
    for (const t of [...a.tiles()]) a.relinquish(t);
    executeTicks(game, 60);
    expect(rig!.isActive()).toBe(false);
  });
});

describe("air war", () => {
  async function war() {
    const game = await setup(
      "big_plains",
      { instantBuild: true, difficulty: Difficulty.Hard },
      [
        new PlayerInfo("a", PlayerType.Human, "a", "a"),
        new PlayerInfo("b", PlayerType.Human, "b", "b"),
      ],
    );
    const a = game.player("a");
    const b = game.player("b");
    conquerRect(game, a, 0, 0, 60, 200);
    conquerRect(game, b, 60, 0, 200, 200);
    a.addGold(50_000_000n);
    b.addGold(50_000_000n);
    a.addTroops(100_000);
    b.addTroops(100_000);
    return { game, a, b };
  }

  function raid(game: Game, a: Player, x: number, y: number) {
    const exec = new WeaponStrikeExecution(a, "airstrike", game.ref(x, y));
    game.addExecution(exec);
    game.executeNextTick();
    expect(exec.rejection).toBeNull();
  }

  it("a bomber flies to the target, bombs it and flies home", async () => {
    const { game, a, b } = await war();
    expect(build(game, a, UnitType.Airbase, 20, 100)).toBeDefined();
    const troops = b.troops();
    raid(game, a, 150, 100);
    let sawBomber = false;
    let sawBombs = false;
    let maxX = 0;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      const bombers = game.units(UnitType.Bomber);
      if (bombers.length > 0) {
        sawBomber = true;
        maxX = Math.max(maxX, game.x(bombers[0].tile()));
      }
      if (game.units(UnitType.ArtilleryShell).length > 0) sawBombs = true;
    }
    expect(sawBomber).toBe(true);
    expect(maxX).toBeGreaterThanOrEqual(147);
    expect(sawBombs).toBe(true);
    expect(b.troops()).toBeLessThan(troops);
    // Back home and landed.
    expect(game.units(UnitType.Bomber)).toHaveLength(0);
  });

  it("enemy fighters and SAMs shoot bombers down", async () => {
    const { game, a, b } = await war();
    build(game, a, UnitType.Airbase, 20, 100);
    build(game, b, UnitType.Airbase, 140, 100);
    build(game, b, UnitType.SAMLauncher, 148, 104);
    raid(game, a, 150, 100);
    let sawFighter = false;
    let minHealth: number = BOMBER.maxHealth;
    let bomber: Unit | null = null;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      if (game.units(UnitType.Fighter).length > 0) sawFighter = true;
      const bs = game.units(UnitType.Bomber);
      if (bs.length > 0) bomber = bs[0];
      if (bomber !== null && bomber.isActive()) {
        minHealth = Math.min(minHealth, bomber.health());
      }
    }
    expect(sawFighter).toBe(true);
    expect(bomber).not.toBeNull();
    expect(bomber!.isActive()).toBe(false);
    expect(minHealth).toBeLessThan(BOMBER.maxHealth);
  });

  it("snapshot round trip mid-raid", async () => {
    const { game, a, b } = await war();
    build(game, a, UnitType.Airbase, 20, 100);
    build(game, b, UnitType.Airbase, 140, 100);
    build(game, a, UnitType.Market, 30, 30);
    raid(game, a, 150, 100);
    executeTicks(game, 30);
    await expectSnapshotRoundTrip(game, "big_plains", 40);
  });
});

describe("NationEconomyBehavior", () => {
  it("builds income buildings when rich", async () => {
    const game = await setup(
      "plains",
      { instantBuild: true, difficulty: Difficulty.Hard },
      [new PlayerInfo("a", PlayerType.Human, "a", "a")],
    );
    const a = game.player("a");
    conquerRect(game, a, 20, 20, 80, 80);
    a.addGold(100_000_000n);
    const ai = new NationEconomyBehavior(game, a);
    for (let i = 0; i < 600; i++) {
      if (i % 10 === 0) ai.maybeBuild();
      game.executeNextTick();
    }
    const built =
      a.units(UnitType.Market).length + a.units(UnitType.Airbase).length;
    expect(built).toBeGreaterThan(0);
    expect(a.units(UnitType.Market).length).toBeLessThanOrEqual(3);
  });
});

describe("strike cost with infinite gold", () => {
  it("is free for a human with infinite gold, full price otherwise", async () => {
    const free = await setup("plains", { infiniteGold: true }, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
      new PlayerInfo("n", PlayerType.Nation, null, "n"),
    ]);
    expect(free.config().strikeCost(100_000n, free.player("a"))).toBe(0n);
    expect(free.config().strikeCost(100_000n, free.player("n"))).toBe(100_000n);
    const paid = await setup("plains", {}, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
    ]);
    expect(paid.config().strikeCost(100_000n, paid.player("a"))).toBe(100_000n);
  });
});
