import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  launcherRange,
  lineOfFireBlocked,
  WEAPONS,
  type FireTerrain,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { WeaponStrikeExecution } from "@laukolaroser/engine/execution/WeaponStrikeExecution";
import { Game, Player } from "@laukolaroser/engine/game/Game";
import { vi } from "vitest";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

/** A W×H land grid; `mag(x, y)` gives each tile's magnitude. */
function grid(
  w: number,
  h: number,
  mag: (x: number, y: number) => number,
  water: (x: number, y: number) => boolean = () => false,
): FireTerrain {
  return {
    x: (r) => r % w,
    y: (r) => Math.floor(r / w),
    ref: (x, y) => y * w + x,
    isLand: (r) => !water(r % w, Math.floor(r / w)),
    magnitude: (r) => mag(r % w, Math.floor(r / w)),
  };
}

describe("lineOfFireBlocked", () => {
  const W = 100;
  // A north-south mountain wall at x = 48..50, plains elsewhere.
  const wall = grid(W, 40, (x) => (x >= 48 && x <= 50 ? 26 : 3));
  const at = (x: number, y: number) => wall.ref(x, y);

  it("a mountain wall stops shells and rockets but not bombers", () => {
    for (const w of ["artillery", "naval", "rocket"] as const) {
      expect(lineOfFireBlocked(wall, at(20, 20), at(80, 20), w)).toBe(true);
    }
    expect(lineOfFireBlocked(wall, at(20, 20), at(80, 20), "airstrike")).toBe(
      false,
    );
  });

  it("open ground, or a shot on the same side, is clear", () => {
    expect(lineOfFireBlocked(wall, at(5, 5), at(40, 30), "rocket")).toBe(false);
    expect(lineOfFireBlocked(wall, at(60, 5), at(95, 35), "rocket")).toBe(
      false,
    );
  });

  it("a gun on the mountain itself fires over it", () => {
    expect(lineOfFireBlocked(wall, at(49, 20), at(90, 20), "artillery")).toBe(
      false,
    );
  });

  it("a lone peak does not block, a range does", () => {
    const peak = grid(W, 40, (x, y) => (x === 50 && y === 20 ? 30 : 3));
    expect(
      lineOfFireBlocked(peak, peak.ref(10, 20), peak.ref(90, 20), "rocket"),
    ).toBe(false);
  });

  it("only ridges clearly above both ends block", () => {
    // Both ends high in the mountains, the middle barely higher: clear.
    const hills = grid(W, 40, (x) => (x >= 45 && x <= 55 ? 24 : 22));
    expect(
      lineOfFireBlocked(hills, hills.ref(10, 20), hills.ref(90, 20), "rocket"),
    ).toBe(false);
    // Highland valleys either side of a high range: blocked.
    const range = grid(W, 40, (x) => (x >= 45 && x <= 55 ? 28 : 12));
    expect(
      lineOfFireBlocked(range, range.ref(10, 20), range.ref(90, 20), "rocket"),
    ).toBe(true);
  });

  it("works in every direction (symmetric)", () => {
    const pairs: [number, number, number, number][] = [
      [20, 5, 80, 35],
      [80, 35, 20, 5],
      [80, 5, 20, 35],
      [20, 35, 80, 5],
    ];
    for (const [a, b, c, d] of pairs) {
      expect(lineOfFireBlocked(wall, at(a, b), at(c, d), "naval")).toBe(true);
    }
  });
});

describe("launcherRange", () => {
  const t = grid(
    10,
    1,
    (x) => (x === 0 ? 3 : x === 1 ? 12 : 25),
    (x) => (x === 9 ? true : false),
  );
  it("gives high ground more range; ships and bombers unchanged", () => {
    const art = WEAPONS.artillery;
    expect(launcherRange(t, art, 0)).toBe(art.range);
    expect(launcherRange(t, art, 1)).toBe(Math.floor((art.range * 110) / 100));
    expect(launcherRange(t, art, 2)).toBe(Math.floor((art.range * 120) / 100));
    expect(launcherRange(t, WEAPONS.naval, 9)).toBe(WEAPONS.naval.range);
    expect(launcherRange(t, WEAPONS.airstrike, 2)).toBe(
      WEAPONS.airstrike.range,
    );
  });
});

function conquerRect(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
}

describe("strikes against a mountain wall (engine)", () => {
  it("rejects a shot through a range and fires over open ground", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
      new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
    ]);
    const a = game.player("alice");
    const b = game.player("bob");
    conquerRect(game, a, 0, 0, 100, 200);
    conquerRect(game, b, 100, 0, 200, 200);
    a.addGold(10_000_000n);
    b.addTroops(100_000);
    game.addExecution(
      new ConstructionExecution(a, UnitType.DefensePost, game.ref(90, 100)),
    );
    executeTicks(game, 4);

    // A mountain range runs north-south at x = 100..102.
    const real = game.magnitude.bind(game);
    vi.spyOn(game, "magnitude").mockImplementation((t) => {
      const x = game.x(t);
      return x >= 100 && x <= 102 ? 28 : real(t);
    });

    const blocked = new WeaponStrikeExecution(
      a,
      "artillery",
      game.ref(115, 100),
    );
    game.addExecution(blocked);
    game.executeNextTick();
    expect(blocked.rejection).toBe("blocked_by_terrain");

    // Without the range the same shot fires.
    vi.restoreAllMocks();
    const clear = new WeaponStrikeExecution(a, "artillery", game.ref(115, 100));
    game.addExecution(clear);
    game.executeNextTick();
    expect(clear.rejection).toBeNull();
  });
});
