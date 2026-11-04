import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import type { GameConfig } from "@laukolaroser/engine-api/Schemas";
import {
  COASTAL_BATTERY,
  FORT,
  SEA_MINE,
} from "@laukolaroser/engine-lib/defense/Defenses";
import { NAVAL_CLASSES } from "@laukolaroser/engine-lib/naval/NavalClasses";
import { EngineConfig } from "@laukolaroser/engine/configuration/EngineConfig";
import { AttackExecution } from "@laukolaroser/engine/execution/AttackExecution";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { NationDefenseBehavior } from "@laukolaroser/engine/execution/nation/NationDefenseBehavior";
import { WarshipExecution } from "@laukolaroser/engine/execution/WarshipExecution";
import { Game, Player, Unit } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "half_land_half_ocean";
const COAST_X = 7;

let game: Game;
let p1: Player;
let p2: Player;

async function makeGame() {
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

function build(owner: Player, type: UnitType, x: number, y: number): Unit {
  game.addExecution(new ConstructionExecution(owner, type, game.ref(x, y)));
  executeTicks(game, 3);
  const all = owner.units(type);
  return all[all.length - 1];
}

describe("Fort", () => {
  test("attackers lose more and move slower near an enemy fort", () => {
    // The real rules (test games stub attackLogic).
    const cfg = new EngineConfig({} as GameConfig, false);
    const input = (defenderHasFort: boolean) => ({
      terrain: TerrainType.Plains,
      attackerTerrain: TerrainType.Plains,
      attackTroops: 400_000,
      attacker: { type: PlayerType.Human, numTiles: 1000 },
      defender: {
        type: PlayerType.Human,
        numTiles: 1000,
        troops: 50_000,
        isTraitor: false,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: false,
      defenderHasFort,
      falloutRatio: null,
      borderSize: 100,
    });
    const plain = cfg.attackLogic(input(false));
    const fort = cfg.attackLogic(input(true));
    expect(fort.attackerTroopLoss).toBeCloseTo(
      plain.attackerTroopLoss * FORT.lossFactor,
    );
    expect(fort.tickFraction).toBeGreaterThan(plain.tickFraction);
  });

  test("attacks check for a defender's fort within range", async () => {
    await makeGame();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x <= COAST_X; x++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        if (x < 3) p1.conquer(t);
        else p2.conquer(t);
      }
    p1.addTroops(200_000);
    p2.addTroops(50_000);
    build(p2, UnitType.Fort, 5, 8);
    const spy = vi.spyOn(game.config(), "attackLogic");
    game.addExecution(new AttackExecution(50_000, p1, p2.id()));
    executeTicks(game, 10);
    const calls = spy.mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.defenderHasFort === true)).toBe(true);
  });
});

describe("Coastal Battery", () => {
  beforeEach(makeGame);

  test("only on the shore, and it shells enemy warships in range", () => {
    p1.conquer(game.ref(COAST_X, 8));
    p1.conquer(game.ref(3, 8));
    expect(p1.canBuild(UnitType.CoastalBattery, game.ref(3, 8))).not.toBe(
      game.ref(3, 8),
    );
    const battery = build(p1, UnitType.CoastalBattery, COAST_X, 8);
    expect(battery).toBeDefined();
    expect(game.isShore(battery.tile())).toBe(true);
    const enemy = ship(p2, UnitType.Warship, 12, 8);
    let hit = false;
    for (let i = 0; i < 80 && !hit; i++) {
      game.executeNextTick();
      hit = !enemy.isActive() || enemy.health() < 1000;
    }
    expect(hit).toBe(true);
    expect(COASTAL_BATTERY.range).toBeGreaterThan(5);
  });
});

describe("Sea Mine", () => {
  beforeEach(makeGame);

  function layMine(x: number, y: number) {
    for (let yy = 0; yy < 16; yy++) p1.conquer(game.ref(COAST_X, yy));
    return build(p1, UnitType.SeaMine, x, y);
  }

  test("can only be laid at sea near your land, spaced apart", () => {
    expect(p1.canBuild(UnitType.SeaMine, game.ref(12, 8))).toBe(false);
    const mine = layMine(12, 8);
    expect(mine).toBeDefined();
    expect(p1.canBuild(UnitType.SeaMine, game.ref(13, 8))).toBe(false);
    expect(p1.canBuild(UnitType.SeaMine, game.ref(3, 8))).toBe(false); // land
  });

  test("blows up an enemy warship that sails into it", () => {
    const mine = layMine(12, 8);
    const enemy = ship(p2, UnitType.Warship, 13, 8);
    executeTicks(game, 4);
    expect(mine.isActive()).toBe(false);
    expect(!enemy.isActive() || enemy.health() <= 1000 - SEA_MINE.damage).toBe(
      true,
    );
  });

  test("destroyers sweep mines without damage", () => {
    const mine = layMine(12, 8);
    const d = ship(p2, UnitType.Destroyer, 13, 8);
    executeTicks(game, 4);
    expect(mine.isActive()).toBe(false);
    expect(d.isActive()).toBe(true);
    expect(d.health()).toBe(NAVAL_CLASSES[UnitType.Destroyer].maxHealth);
  });

  test("own ships are safe", () => {
    const mine = layMine(12, 8);
    ship(p1, UnitType.Warship, 13, 8);
    executeTicks(game, 6);
    expect(mine.isActive()).toBe(true);
  });

  test("snapshot round trip with a battery and mines", async () => {
    layMine(12, 4);
    build(p1, UnitType.CoastalBattery, COAST_X, 12);
    ship(p2, UnitType.Warship, 14, 12);
    executeTicks(game, 5);
    await expectSnapshotRoundTrip(game, MAP, 20);
  });
});

describe("NationDefenseBehavior", () => {
  test("a nation under attack builds a fort behind its front", async () => {
    const g = await setup(
      "big_plains",
      { instantBuild: true, difficulty: Difficulty.Hard },
      [
        new PlayerInfo("n", PlayerType.Nation, null, "n"),
        new PlayerInfo("h", PlayerType.Human, null, "h"),
      ],
    );
    const n = g.player("n");
    const h = g.player("h");
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const t = g.ref(x, y);
        if (!g.isLand(t)) continue;
        if (x < 60) h.conquer(t);
        else n.conquer(t);
      }
    n.addGold(100_000_000n);
    n.addTroops(1_000_000);
    h.addTroops(400_000);
    g.addExecution(new AttackExecution(100_000, h, n.id()));
    g.executeNextTick();
    const ai = new NationDefenseBehavior(g, n);
    let built = 0;
    for (let i = 0; i < 200 && built === 0; i++) {
      if (n.incomingAttacks().length === 0) {
        h.addTroops(100_000);
        g.addExecution(new AttackExecution(100_000, h, n.id()));
      }
      if (ai.maybeBuild() === UnitType.Fort) built++;
      g.executeNextTick();
    }
    expect(built).toBeGreaterThan(0);
    executeTicks(g, 3);
    expect(n.units(UnitType.Fort).length).toBeGreaterThan(0);
  });
});
