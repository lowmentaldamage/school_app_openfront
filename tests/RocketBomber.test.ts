import {
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  airbaseReady,
  bombLine,
  bombsForLevel,
  ROCKET_BOMBER,
} from "@laukolaroser/engine-lib/air/RocketBomber";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { RocketBomberExecution } from "@laukolaroser/engine/execution/RocketBomberExecution";
import type { Game, Player } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

function claim(
  g: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = g.ref(x, y);
      if (g.isLand(t) && !g.hasOwner(t)) p.conquer(t);
    }
  }
}

describe("rocket bomber rules", () => {
  it("10, 25 and 50 bombs by airbase level", () => {
    expect([1, 2, 3, 4].map(bombsForLevel)).toEqual([10, 25, 50, 50]);
  });

  it("spreads bombs evenly along the line and caps its length", () => {
    const pts = bombLine(0, 0, 90, 0, 10, 1000, 1000);
    expect(pts).toHaveLength(10);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[9]).toEqual([90, 0]);
    expect(pts[1][0] - pts[0][0]).toBe(10);
    const long = bombLine(0, 0, 500, 0, 5, 1000, 1000);
    expect(long[4][0]).toBe(ROCKET_BOMBER.maxLineLength);
  });

  it("an airbase reloads for 30 seconds", () => {
    expect(airbaseReady([], 100)).toBe(true);
    expect(airbaseReady([100], 100 + ROCKET_BOMBER.cooldownTicks - 1)).toBe(
      false,
    );
    expect(airbaseReady([100], 100 + ROCKET_BOMBER.cooldownTicks)).toBe(true);
  });
});

describe("rocket bomber run", () => {
  async function war() {
    const game = await setup(
      "world",
      { instantBuild: true, gameType: GameType.Singleplayer },
      [
        new PlayerInfo("attacker", PlayerType.Human, "a", "a"),
        new PlayerInfo("defender", PlayerType.Human, "b", "b"),
      ],
    );
    const a = game.player("a");
    const b = game.player("b");
    claim(game, a, 960, 150, 1060, 270);
    claim(game, b, 1060, 150, 1170, 270);
    a.addGold(1_000_000_000n);
    b.addTroops(500_000);
    let built = false;
    for (const t of a.tiles()) {
      if (a.canBuild(UnitType.Airbase, t) !== false) {
        game.addExecution(new ConstructionExecution(a, UnitType.Airbase, t));
        built = true;
        break;
      }
    }
    expect(built).toBe(true);
    executeTicks(game, 5);
    expect(a.units(UnitType.Airbase)).toHaveLength(1);
    return { game, a, b };
  }

  it("flies the line, kills troops, takes land, costs gold and reloads", async () => {
    const { game, a, b } = await war();
    const from = game.ref(1075, 200);
    const to = game.ref(1075, 240);
    const gold = a.gold();
    const troops = b.troops();
    const tiles = a.numTilesOwned();
    const run = new RocketBomberExecution(a, from, to);
    game.addExecution(run);
    executeTicks(game, 2);
    expect(run.rejection).toBeNull();
    expect(gold - a.gold()).toBe(ROCKET_BOMBER.cost);
    expect(a.units(UnitType.Bomber)).toHaveLength(1);
    await expectSnapshotRoundTrip(game, "world", 20);

    // A second run straight away: the airbase is reloading.
    const again = new RocketBomberExecution(a, from, to);
    game.addExecution(again);
    executeTicks(game, 1);
    expect(again.rejection).toBe("reloading");

    executeTicks(game, 200);
    expect(b.troops()).toBeLessThan(troops);
    expect(a.numTilesOwned()).toBeGreaterThan(tiles);
    // Home and landed.
    expect(a.units(UnitType.Bomber)).toHaveLength(0);
  });

  it("refuses without an airbase", async () => {
    const { game, b } = await war();
    const run = new RocketBomberExecution(
      b,
      game.ref(1000, 200),
      game.ref(1000, 220),
    );
    game.addExecution(run);
    executeTicks(game, 1);
    expect(run.rejection).toBe("no_airbase");
  });
});
