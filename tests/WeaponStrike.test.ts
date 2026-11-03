import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  strikeTroopLoss,
  WEAPONS,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { WeaponStrikeExecution } from "@laukolaroser/engine/execution/WeaponStrikeExecution";
import { Game, Player } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const BIG = "big_plains";

function conquerRect(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
  }
}

async function battlefield(): Promise<{ game: Game; a: Player; b: Player }> {
  const game = await setup(BIG, { instantBuild: true }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  ]);
  const a = game.player("alice");
  const b = game.player("bob");
  conquerRect(game, a, 0, 0, 100, 200);
  conquerRect(game, b, 100, 0, 200, 200);
  a.addGold(10_000_000n);
  b.addGold(10_000_000n);
  a.addTroops(200_000);
  b.addTroops(200_000);
  return { game, a, b };
}

function build(game: Game, p: Player, x: number, y: number, t: UnitType) {
  game.addExecution(new ConstructionExecution(p, t, game.ref(x, y)));
  executeTicks(game, 4);
}

function fire(
  game: Game,
  p: Player,
  weapon: "artillery" | "naval" | "rocket",
  x: number,
  y: number,
) {
  const exec = new WeaponStrikeExecution(p, weapon, game.ref(x, y));
  game.addExecution(exec);
  game.executeNextTick();
  return exec;
}

describe("strikeTroopLoss", () => {
  it("scales with the share of land hit and never exceeds the army", () => {
    const spec = WEAPONS.artillery;
    expect(strikeTroopLoss(spec, 100_000, 10_000, 0)).toBe(0);
    const small = strikeTroopLoss(spec, 100_000, 10_000, 10);
    const big = strikeTroopLoss(spec, 100_000, 10_000, 30);
    expect(big).toBeGreaterThan(small);
    expect(strikeTroopLoss(spec, 50, 10, 10)).toBe(50);
  });

  it("is integer (deterministic)", () => {
    for (const spec of Object.values(WEAPONS)) {
      expect(Number.isInteger(strikeTroopLoss(spec, 123_457, 9_871, 17))).toBe(
        true,
      );
    }
  });
});

describe("WeaponStrikeExecution", () => {
  it("artillery from a defense post bleeds enemy troops without taking land", async () => {
    const { game, a, b } = await battlefield();
    build(game, a, 90, 100, UnitType.DefensePost);
    expect(a.units(UnitType.DefensePost)).toHaveLength(1);

    const goldBefore = a.gold();
    const troopsBefore = b.troops();
    const tilesA = a.numTilesOwned();
    const tilesB = b.numTilesOwned();

    const exec = fire(game, a, "artillery", 115, 100);
    expect(exec.rejection).toBeNull();
    expect(a.gold()).toBe(goldBefore - WEAPONS.artillery.cost);

    executeTicks(game, 60);
    expect(b.troops()).toBeLessThan(troopsBefore);
    expect(a.numTilesOwned()).toBe(tilesA);
    expect(b.numTilesOwned()).toBe(tilesB);
    expect(a.units(UnitType.ArtilleryShell)).toHaveLength(0);
  });

  it("puts the launcher on cooldown, then reloads it", async () => {
    const { game, a } = await battlefield();
    build(game, a, 90, 100, UnitType.DefensePost);
    expect(fire(game, a, "artillery", 115, 100).rejection).toBeNull();
    expect(fire(game, a, "artillery", 115, 100).rejection).toBe("no_launcher");
    executeTicks(game, WEAPONS.artillery.cooldownTicks);
    expect(fire(game, a, "artillery", 115, 100).rejection).toBeNull();
  });

  it("rejects own land, out-of-range targets and empty wallets", async () => {
    const { game, a } = await battlefield();
    build(game, a, 90, 100, UnitType.DefensePost);
    expect(fire(game, a, "artillery", 80, 100).rejection).toBe(
      "friendly_target",
    );
    expect(fire(game, a, "artillery", 190, 100).rejection).toBe("no_launcher");
    expect(fire(game, a, "rocket", 120, 100).rejection).toBe("no_launcher");
    a.removeGold(a.gold());
    expect(fire(game, a, "artillery", 115, 100).rejection).toBe(
      "not_enough_gold",
    );
  });

  it("a rocket from a missile silo destroys a level-1 building", async () => {
    const { game, a, b } = await battlefield();
    build(game, a, 50, 100, UnitType.MissileSilo);
    build(game, b, 140, 100, UnitType.City);
    expect(b.units(UnitType.City)).toHaveLength(1);

    const exec = fire(game, a, "rocket", 140, 100);
    expect(exec.rejection).toBeNull();
    executeTicks(game, 80);
    expect(b.units(UnitType.City)).toHaveLength(0);
    // The silo slot is used, like a nuke launch.
    expect(
      a.units(UnitType.MissileSilo)[0].missileTimerQueue().length,
    ).toBeGreaterThan(0);
  });

  it("survives a save/restore mid-flight", async () => {
    const { game, a } = await battlefield();
    build(game, a, 90, 100, UnitType.DefensePost);
    fire(game, a, "artillery", 120, 100);
    executeTicks(game, 3);
    expect(a.units(UnitType.ArtilleryShell).length).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, BIG, 40);
  });
});
