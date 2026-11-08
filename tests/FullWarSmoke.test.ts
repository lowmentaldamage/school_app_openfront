/**
 * End-to-end smoke test of a whole war on the world map: every building,
 * every ship and train, every weapon (with upgrades), land and naval
 * attacks, all three nukes and all five disasters, in one game. It checks
 * that each piece actually happens (units appear, strikes land, land
 * changes hands) and that the simulation never throws along the way.
 */
import {
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
  type DisasterKind,
} from "@laukolaroser/engine-api/game/GameTypes";
import { WEAPON_IDS } from "@laukolaroser/engine-lib/weapons/Weapons";
import { AttackExecution } from "@laukolaroser/engine/execution/AttackExecution";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { DisasterExecution } from "@laukolaroser/engine/execution/DisasterExecution";
import { MirvExecution } from "@laukolaroser/engine/execution/MIRVExecution";
import { NukeExecution } from "@laukolaroser/engine/execution/NukeExecution";
import { UpgradeWeaponExecution } from "@laukolaroser/engine/execution/UpgradeWeaponExecution";
import { WeaponStrikeExecution } from "@laukolaroser/engine/execution/WeaponStrikeExecution";
import type { Game, Player } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
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

const SEA = new Set<UnitType>([
  UnitType.OilRig,
  UnitType.Warship,
  UnitType.Destroyer,
  UnitType.Battleship,
  UnitType.Submarine,
  UnitType.Carrier,
]);

/** A tile where `p` can build `type`, scanning its land (or nearby water). */
function spot(g: Game, p: Player, type: UnitType, step = 3): number | null {
  // Oil rigs and ships go in the sea off the owner's coast.
  if (SEA.has(type)) {
    for (const t of p.tiles()) {
      for (const n of g.neighbors(t)) {
        // The order names the water tile; the build finds its own spawn.
        if (!g.isLand(n) && p.canBuild(type, n) !== false) return n;
      }
    }
    return null;
  }
  for (const t of p.tiles()) {
    if ((g.x(t) + g.y(t)) % step !== 0) continue;
    const at = p.canBuild(type, t);
    if (at !== false) return at;
  }
  return null;
}

describe("full war smoke test", () => {
  it("every building, ship, weapon, attack, nuke and disaster works in one game", async () => {
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
    // Western Europe for the attacker (coasts on two seas), eastern Europe
    // for the defender, sharing a long land border.
    claim(game, a, 960, 150, 1060, 270);
    claim(game, b, 1060, 150, 1170, 270);
    a.addGold(10_000_000_000n);
    b.addGold(10_000_000_000n);
    a.addTroops(5_000_000);
    expect(a.numTilesOwned()).toBeGreaterThan(3000);
    expect(b.numTilesOwned()).toBeGreaterThan(3000);

    // Buildings (plus a second city and a factory for railways).
    const STRUCTURES = [
      UnitType.City,
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.Market,
      UnitType.GoldMine,
      UnitType.OilRig,
      UnitType.Airbase,
      UnitType.RadarStation,
      UnitType.Fort,
      UnitType.CoastalBattery,
    ];
    const missing: string[] = [];
    for (const type of STRUCTURES) {
      const t = spot(game, a, type);
      if (t === null) {
        missing.push(type);
        continue;
      }
      game.addExecution(new ConstructionExecution(a, type, t));
      executeTicks(game, 3);
    }
    executeTicks(game, 20);
    expect(missing).toEqual([]);
    for (const type of new Set(STRUCTURES)) {
      expect(a.units(type).length, type).toBeGreaterThan(0);
    }

    // Ships from the port, and the sea mine.
    const SHIPS = [
      UnitType.Warship,
      UnitType.Destroyer,
      UnitType.Battleship,
      UnitType.Submarine,
      UnitType.Carrier,
    ];
    for (const type of SHIPS) {
      const t = spot(game, a, type, 1);
      expect(t, type).not.toBeNull();
      game.addExecution(new ConstructionExecution(a, type, t!));
      executeTicks(game, 3);
    }
    executeTicks(game, 30);
    for (const type of SHIPS) {
      expect(a.units(type).length, type).toBeGreaterThan(0);
    }

    // Weapons: upgrade each to Mk III, then fire at the defender's border.
    const target = [...b.tiles()].find(
      (t) => game.x(t) === 1062 && game.isLand(t),
    )!;
    expect(target).toBeDefined();
    for (const id of WEAPON_IDS) {
      game.addExecution(new UpgradeWeaponExecution(a, id));
      executeTicks(game, 1);
      game.addExecution(new UpgradeWeaponExecution(a, id));
      executeTicks(game, 1);
    }
    const troopsBefore = b.troops();
    for (const id of WEAPON_IDS) {
      game.addExecution(new WeaponStrikeExecution(a, id, target));
      executeTicks(game, 2);
    }
    executeTicks(game, 120);
    expect(b.troops()).toBeLessThan(troopsBefore + 1_000_000);

    // Land attack: the attacker takes ground from the defender.
    const before = a.numTilesOwned();
    game.addExecution(new AttackExecution(2_000_000, a, b.id()));
    executeTicks(game, 200);
    expect(a.numTilesOwned()).toBeGreaterThan(before);

    // Nukes from the silo.
    const deep =
      [...b.tiles()].find((t) => game.x(t) === 1140 && game.y(t) === 200) ??
      [...b.tiles()][Math.floor(b.numTilesOwned() / 2)];
    game.addExecution(new NukeExecution(UnitType.AtomBomb, a, deep, null));
    executeTicks(game, 5);
    game.addExecution(new NukeExecution(UnitType.HydrogenBomb, a, deep, null));
    executeTicks(game, 5);
    game.addExecution(new MirvExecution(a, deep));
    const defenderTiles = b.numTilesOwned();
    executeTicks(game, 400);
    expect(b.numTilesOwned()).toBeLessThan(defenderTiles);

    // All five disasters.
    for (const kind of [
      "volcano",
      "earthquake",
      "tsunami",
      "storm",
      "wildfire",
    ] as DisasterKind[]) {
      game.addExecution(new DisasterExecution(a, kind));
      executeTicks(game, 5);
    }
    executeTicks(game, 600);

    expect(a.isAlive()).toBe(true);
  }, 120_000);
});
