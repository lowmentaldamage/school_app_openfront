import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  NAVAL_CLASSES,
  navalClass,
  navalStepsOnTick,
} from "@laukolaroser/engine-lib/naval/NavalClasses";
import { AttackExecution } from "@laukolaroser/engine/execution/AttackExecution";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { MoveWarshipExecution } from "@laukolaroser/engine/execution/MoveWarshipExecution";
import { NationNavyBehavior } from "@laukolaroser/engine/execution/nation/NationNavyBehavior";
import { ShellExecution } from "@laukolaroser/engine/execution/ShellExecution";
import { WarshipExecution } from "@laukolaroser/engine/execution/WarshipExecution";
import { WeaponStrikeExecution } from "@laukolaroser/engine/execution/WeaponStrikeExecution";
import { Game, Player, Unit } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "half_land_half_ocean";
const COAST_X = 7;

let game: Game;
let p1: Player;
let p2: Player;

async function makeGame(): Promise<void> {
  game = await setup(MAP, { infiniteGold: true, instantBuild: true }, [
    new PlayerInfo("one", PlayerType.Human, null, "p1"),
    new PlayerInfo("two", PlayerType.Human, null, "p2"),
  ]);
  p1 = game.player("p1");
  p2 = game.player("p2");
  executeTicks(game, 50);
}

function ship(owner: Player, type: UnitType, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  const u = owner.buildUnit(type, tile, { patrolTile: tile });
  game.addExecution(new WarshipExecution(u));
  return u;
}

describe("naval class rules", () => {
  test("warship always takes exactly one step per tick", () => {
    for (let t = 0; t < 50; t++) {
      expect(navalStepsOnTick(NAVAL_CLASSES[UnitType.Warship], t)).toBe(1);
    }
  });

  test("destroyers are faster and battleships slower over time", () => {
    const sum = (type: UnitType) => {
      let s = 0;
      for (let t = 1; t <= 600; t++) s += navalStepsOnTick(navalClass(type), t);
      return s;
    };
    expect(sum(UnitType.Destroyer)).toBe(1000);
    expect(sum(UnitType.Battleship)).toBe(400);
  });

  test("unit info and costs differ per class", async () => {
    await makeGame();
    const cfg = game.config();
    expect(cfg.unitInfo(UnitType.Warship).maxHealth).toBe(1000);
    expect(cfg.unitInfo(UnitType.Destroyer).maxHealth).toBe(450);
    expect(cfg.unitInfo(UnitType.Battleship).maxHealth).toBe(3500);
    const poor = await setup(MAP, {}, [
      new PlayerInfo("x", PlayerType.Human, null, "x"),
    ]);
    const x = poor.player("x");
    const cost = (t: UnitType) => poor.unitInfo(t).cost(poor, x);
    expect(cost(UnitType.Destroyer)).toBeLessThan(cost(UnitType.Warship));
    expect(cost(UnitType.Battleship)).toBeGreaterThan(cost(UnitType.Warship));
  });
});

describe("Destroyer and Battleship", () => {
  beforeEach(makeGame);

  test("built from a port like a warship", () => {
    p1.conquer(game.ref(COAST_X, 8));
    p1.buildUnit(UnitType.Port, game.ref(COAST_X, 8), {});
    for (const type of [UnitType.Destroyer, UnitType.Battleship]) {
      game.addExecution(
        new ConstructionExecution(p1, type, game.ref(COAST_X + 3, 8)),
      );
    }
    executeTicks(game, 3);
    expect(p1.units(UnitType.Destroyer)).toHaveLength(1);
    expect(p1.units(UnitType.Battleship)).toHaveLength(1);
    const d = p1.units(UnitType.Destroyer)[0];
    expect(d.health()).toBe(450);
    expect(d.warshipState().state).toBe("patrolling");
  });

  test("move speed follows the class", () => {
    const moves = (type: UnitType, y: number) => {
      const u = ship(p1, type, 12, y);
      const spy = vi.spyOn(u, "move");
      return { spy };
    };
    const w = moves(UnitType.Warship, 2);
    const d = moves(UnitType.Destroyer, 8);
    const b = moves(UnitType.Battleship, 14);
    executeTicks(game, 60);
    const nw = w.spy.mock.calls.length;
    const nd = d.spy.mock.calls.length;
    const nb = b.spy.mock.calls.length;
    expect(nd).toBeGreaterThan(nw);
    expect(nb).toBeLessThan(nw);
  });

  test("combat ships of every class fight each other", () => {
    const d = ship(p1, UnitType.Destroyer, 10, 5);
    const w = ship(p2, UnitType.Warship, 12, 5);
    executeTicks(game, 40);
    expect(w.health()).toBeLessThan(1000);
    expect(d.health()).toBeLessThan(450);
  });

  test("battleship shells hit much harder than destroyer shells", () => {
    const dmg = (type: UnitType) => {
      const from = ship(p1, type, 10, 2);
      const target = ship(p2, UnitType.Warship, 12, 2);
      const exec = new ShellExecution(from.tile(), p1, from, target);
      exec.init(game, game.ticks());
      const v = exec.getEffectOnTargetForTesting();
      from.delete(false);
      target.delete(false);
      return v;
    };
    // Rolls vary; compare the minimum possible against the maximum.
    expect(dmg(UnitType.Battleship)).toBeGreaterThan(500);
    expect(dmg(UnitType.Destroyer)).toBeLessThan(400);
  });

  test("move orders apply to destroyers and battleships", () => {
    const d = ship(p1, UnitType.Destroyer, 10, 3);
    const target = game.ref(13, 13);
    game.addExecution(new MoveWarshipExecution(p1, [d.id()], target));
    game.executeNextTick();
    expect(d.warshipState().patrolTile).toBe(target);
  });

  test("battleship bombards the coast only during a land war", () => {
    for (let x = 0; x <= COAST_X; x++) {
      for (let y = 0; y < 16; y++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        if (y < 4) p1.conquer(t);
        else p2.conquer(t);
      }
    }
    p1.addTroops(50_000);
    p2.addTroops(50_000);
    ship(p1, UnitType.Battleship, 12, 10);
    const shells = () =>
      game.units(UnitType.ArtilleryShell).filter((u) => u.owner() === p1)
        .length;

    executeTicks(game, 30);
    expect(shells()).toBe(0);

    game.addExecution(new AttackExecution(20_000, p1, p2.id()));
    let seen = 0;
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
      seen = Math.max(seen, shells());
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("snapshot round trip with every class at sea", async () => {
    p1.conquer(game.ref(COAST_X, 8));
    p1.buildUnit(UnitType.Port, game.ref(COAST_X, 8), {});
    game.addExecution(
      new ConstructionExecution(p1, UnitType.Destroyer, game.ref(10, 8)),
    );
    game.addExecution(
      new WarshipExecution({
        owner: p1,
        patrolTile: game.ref(11, 4),
        type: UnitType.Battleship,
      }),
    );
    ship(p2, UnitType.Warship, 13, 12);
    executeTicks(game, 2);
    expect(p1.units(UnitType.Destroyer)).toHaveLength(1);
    expect(p1.units(UnitType.Battleship)).toHaveLength(1);
    await expectSnapshotRoundTrip(game, MAP, 20);
  });
});

describe("NationNavyBehavior", () => {
  beforeEach(makeGame);

  function prepare(owner: Player) {
    for (let y = 0; y < 16; y++) owner.conquer(game.ref(COAST_X, y));
    owner.buildUnit(UnitType.Port, game.ref(COAST_X, 4), {});
    owner.buildUnit(UnitType.Port, game.ref(COAST_X, 12), {});
    owner.addGold(100_000_000n);
  }

  // Nations decide every few ticks, never on consecutive ticks.
  function run(behavior: NationNavyBehavior, ticks: number) {
    for (let i = 0; i < ticks; i++) {
      if (i % 10 === 0) behavior.maybeBuild();
      game.executeNextTick();
    }
  }

  test("builds destroyers once it runs a warship, never more than ports", () => {
    prepare(p1);
    ship(p1, UnitType.Warship, 12, 8);
    const behavior = new NationNavyBehavior(game, p1);
    run(behavior, 2000);
    const n = p1.units(UnitType.Destroyer).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(2);
    expect(p1.units(UnitType.Battleship)).toHaveLength(0);
  });

  test("builds battleships only while at war", () => {
    prepare(p1);
    for (let x = 0; x < COAST_X; x++) {
      for (let y = 0; y < 16; y++) p2.conquer(game.ref(x, y));
    }
    p1.addTroops(500_000);
    p2.addTroops(500_000);
    const behavior = new NationNavyBehavior(game, p1);
    run(behavior, 200);
    expect(p1.units(UnitType.Battleship)).toHaveLength(0);
    game.addExecution(new AttackExecution(30_000, p1, p2.id()));
    game.executeNextTick();
    expect(p1.outgoingAttacks().length).toBeGreaterThan(0);
    run(behavior, 300);
    expect(p1.units(UnitType.Battleship).length).toBeGreaterThan(0);
  });
});

describe("Submarine and Aircraft Carrier", () => {
  beforeEach(makeGame);

  test("submarines are hidden from warships beyond close range", () => {
    const sub = ship(p2, UnitType.Submarine, 14, 2);
    const w = ship(p1, UnitType.Warship, 10, 14); // ~12.6 tiles away
    executeTicks(game, 3);
    expect(sub.health()).toBe(NAVAL_CLASSES[UnitType.Submarine].maxHealth);
    void w;
  });

  test("destroyers hunt submarines at range", () => {
    const sub = ship(p2, UnitType.Submarine, 14, 2);
    ship(p1, UnitType.Destroyer, 10, 13);
    let hurt = false;
    for (let i = 0; i < 60 && !hurt; i++) {
      game.executeNextTick();
      hurt =
        !sub.isActive() ||
        sub.health() < NAVAL_CLASSES[UnitType.Submarine].maxHealth;
    }
    expect(hurt).toBe(true);
  });

  test("a carrier launches air raids and fighters", () => {
    p1.conquer(game.ref(COAST_X, 8));
    p1.buildUnit(UnitType.Port, game.ref(COAST_X, 8), {});
    game.addExecution(
      new WarshipExecution({
        owner: p1,
        patrolTile: game.ref(12, 8),
        type: UnitType.Carrier,
      }),
    );
    executeTicks(game, 3);
    const carrier = p1.units(UnitType.Carrier)[0];
    expect(carrier).toBeDefined();
    // Air raid from the carrier at p2 land.
    p2.conquer(game.ref(2, 2));
    const exec = new WeaponStrikeExecution(p1, "airstrike", game.ref(2, 2));
    game.addExecution(exec);
    game.executeNextTick();
    expect(exec.rejection).toBeNull();
    let bomber = false;
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      if (game.units(UnitType.Bomber).length > 0) bomber = true;
    }
    expect(bomber).toBe(true);
    // Enemy bomber near the carrier: its wing scrambles a fighter.
    const enemy = p2.buildUnit(UnitType.Bomber, game.ref(14, 14), {});
    let fighter = false;
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
      if (game.units(UnitType.Fighter).some((f) => f.owner() === p1)) {
        fighter = true;
      }
    }
    expect(fighter).toBe(true);
    void enemy;
  });
});
