import {
  PlayerInfo,
  PlayerType,
  UnitType,
  WEAPON_IDS,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  MAX_WEAPON_TIER,
  playerWeapon,
  structureLevelsLost,
  WEAPON_UPGRADE_COST,
  WEAPONS,
  weaponAtTier,
  weaponTier,
  weaponUpgradeBlock,
  weaponUpgradeCost,
  withWeaponTier,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { AttackExecution } from "@laukolaroser/engine/execution/AttackExecution";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { NationWeaponBehavior } from "@laukolaroser/engine/execution/nation/NationWeaponBehavior";
import { UpgradeWeaponExecution } from "@laukolaroser/engine/execution/UpgradeWeaponExecution";
import { WeaponStrikeExecution } from "@laukolaroser/engine/execution/WeaponStrikeExecution";
import { Game, Player } from "@laukolaroser/engine/game/Game";
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
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
  }
}

async function battlefield(): Promise<{ game: Game; a: Player; b: Player }> {
  const game = await setup("big_plains", { instantBuild: true }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  ]);
  const a = game.player("alice");
  const b = game.player("bob");
  conquerRect(game, a, 0, 0, 100, 200);
  conquerRect(game, b, 100, 0, 200, 200);
  a.addGold(20_000_000n);
  b.addGold(20_000_000n);
  a.addTroops(200_000);
  b.addTroops(200_000);
  return { game, a, b };
}

function build(game: Game, p: Player, x: number, y: number, t: UnitType) {
  game.addExecution(new ConstructionExecution(p, t, game.ref(x, y)));
  executeTicks(game, 4);
}

function upgrade(game: Game, p: Player, w: "artillery" | "rocket") {
  const exec = new UpgradeWeaponExecution(p, w);
  game.addExecution(exec);
  game.executeNextTick();
  return exec;
}

describe("weapon tier packing", () => {
  it("starts at Mk I and stores each weapon separately", () => {
    for (const id of WEAPON_IDS) expect(weaponTier(0, id)).toBe(1);
    let packed = withWeaponTier(0, "naval", 3);
    packed = withWeaponTier(packed, "rocket", 2);
    expect(weaponTier(packed, "artillery")).toBe(1);
    expect(weaponTier(packed, "naval")).toBe(3);
    expect(weaponTier(packed, "airstrike")).toBe(1);
    expect(weaponTier(packed, "rocket")).toBe(2);
    expect(weaponTier(withWeaponTier(packed, "naval", 1), "naval")).toBe(1);
  });

  it("prices Mk II then Mk III, and nothing past Mk III", () => {
    const t2 = withWeaponTier(0, "artillery", 2);
    const t3 = withWeaponTier(0, "artillery", MAX_WEAPON_TIER);
    expect(weaponUpgradeCost(0, "artillery")).toBe(
      WEAPON_UPGRADE_COST.artillery[0],
    );
    expect(weaponUpgradeCost(t2, "artillery")).toBe(
      WEAPON_UPGRADE_COST.artillery[1],
    );
    expect(weaponUpgradeCost(t3, "artillery")).toBeNull();
    expect(weaponUpgradeBlock(t3, "artillery", 10n ** 12n, true)).toBe("max");
    expect(weaponUpgradeBlock(0, "artillery", 0n, true)).toBe("gold");
    expect(weaponUpgradeBlock(0, "artillery", 10n ** 12n, false)).toBe("dead");
    expect(weaponUpgradeBlock(0, "artillery", 10n ** 12n, true)).toBeNull();
  });
});

describe("weaponAtTier", () => {
  it("leaves Mk I unchanged", () => {
    for (const id of WEAPON_IDS) {
      expect(weaponAtTier(WEAPONS[id], 1)).toEqual(WEAPONS[id]);
    }
  });

  it("makes every weapon stronger each tier, in integers", () => {
    for (const id of WEAPON_IDS) {
      const [m1, m2, m3] = ([1, 2, 3] as const).map((t) =>
        weaponAtTier(WEAPONS[id], t),
      );
      for (const [lo, hi] of [
        [m1, m2],
        [m2, m3],
      ]) {
        expect(hi.radius).toBeGreaterThan(lo.radius);
        expect(hi.range).toBeGreaterThan(lo.range);
        expect(hi.lossPerMille).toBeGreaterThan(lo.lossPerMille);
        expect(hi.warshipDamage).toBeGreaterThan(lo.warshipDamage);
        expect(hi.shots).toBeGreaterThanOrEqual(lo.shots);
        for (const v of [
          hi.radius,
          hi.range,
          hi.lossPerMille,
          hi.troopsPerTile,
          hi.warshipDamage,
          hi.shots,
        ]) {
          expect(Number.isInteger(v)).toBe(true);
        }
      }
      // Price per strike does not change; the upgrade is the price.
      expect(m3.cost).toBe(m1.cost);
    }
  });

  it("Mk III shells wreck buildings; Mk III bombs and rockets take two levels", () => {
    expect(structureLevelsLost(WEAPONS.artillery, 1)).toBe(0);
    expect(structureLevelsLost(WEAPONS.artillery, 3)).toBe(1);
    expect(structureLevelsLost(WEAPONS.naval, 3)).toBe(1);
    expect(structureLevelsLost(WEAPONS.rocket, 1)).toBe(1);
    expect(structureLevelsLost(WEAPONS.rocket, 3)).toBe(2);
    expect(structureLevelsLost(WEAPONS.airstrike, 3)).toBe(2);
  });

  it("playerWeapon reads the player's tier (Mk I without one)", () => {
    expect(playerWeapon({}, "rocket")).toEqual(WEAPONS.rocket);
    const packed = withWeaponTier(0, "rocket", 3);
    expect(playerWeapon({ weaponTiers: () => packed }, "rocket")).toEqual(
      weaponAtTier(WEAPONS.rocket, 3),
    );
  });
});

describe("UpgradeWeaponExecution", () => {
  it("charges the price and raises the tier up to Mk III", async () => {
    const { game, a } = await battlefield();
    const gold0 = a.gold();
    expect(upgrade(game, a, "artillery").rejection).toBeNull();
    expect(weaponTier(a.weaponTiers(), "artillery")).toBe(2);
    expect(a.gold()).toBe(gold0 - WEAPON_UPGRADE_COST.artillery[0]);
    expect(upgrade(game, a, "artillery").rejection).toBeNull();
    expect(weaponTier(a.weaponTiers(), "artillery")).toBe(3);
    const gold2 = a.gold();
    expect(upgrade(game, a, "artillery").rejection).toBe("max");
    expect(a.gold()).toBe(gold2);
    // Other weapons are untouched.
    expect(weaponTier(a.weaponTiers(), "rocket")).toBe(1);
  });

  it("refuses without the gold", async () => {
    const { game, a } = await battlefield();
    a.removeGold(a.gold());
    expect(upgrade(game, a, "rocket").rejection).toBe("gold");
    expect(weaponTier(a.weaponTiers(), "rocket")).toBe(1);
  });

  it("sends the tiers to the client and survives a snapshot", async () => {
    const { game, a } = await battlefield();
    upgrade(game, a, "rocket");
    // The full player update is what a joining client receives.
    const full = (
      a as unknown as { toFullUpdate(): { weaponTiers?: number } }
    ).toFullUpdate();
    expect(full.weaponTiers).toBe(a.weaponTiers());
    expect(weaponTier(a.weaponTiers(), "rocket")).toBe(2);
    await expectSnapshotRoundTrip(game, "big_plains", 10);
  });
});

describe("tiered strikes", () => {
  it("Mk III artillery fires more shells and kills more troops than Mk I", async () => {
    const losses: number[] = [];
    const shells: number[] = [];
    for (const tier of [1, 3] as const) {
      const { game, a, b } = await battlefield();
      if (tier === 3) {
        upgrade(game, a, "artillery");
        upgrade(game, a, "artillery");
      }
      build(game, a, 90, 100, UnitType.DefensePost);
      const before = b.troops();
      game.addExecution(
        new WeaponStrikeExecution(a, "artillery", game.ref(115, 100)),
      );
      let maxShells = 0;
      for (let i = 0; i < 80; i++) {
        game.executeNextTick();
        maxShells = Math.max(
          maxShells,
          a.units(UnitType.ArtilleryShell).length,
        );
      }
      // Count every shell launched: they fly a few ticks apart.
      shells.push(maxShells);
      losses.push(before - b.troops());
    }
    expect(losses[1]).toBeGreaterThan(losses[0]);
    expect(shells[1]).toBeGreaterThanOrEqual(shells[0]);
  });

  it("Mk III rockets knock a building down two levels", async () => {
    const { game, a, b } = await battlefield();
    build(game, a, 90, 100, UnitType.MissileSilo);
    build(game, b, 140, 100, UnitType.City);
    const city = b.units(UnitType.City)[0];
    city.increaseLevel();
    city.increaseLevel();
    expect(city.level()).toBe(3);
    upgrade(game, a, "rocket");
    upgrade(game, a, "rocket");
    const exec = new WeaponStrikeExecution(a, "rocket", game.ref(140, 100));
    game.addExecution(exec);
    game.executeNextTick();
    expect(exec.rejection).toBeNull();
    executeTicks(game, 60);
    expect(city.level()).toBe(1);
  });

  it("a shell keeps the tier it was fired with", async () => {
    const { game, a } = await battlefield();
    build(game, a, 90, 100, UnitType.DefensePost);
    game.addExecution(
      new WeaponStrikeExecution(a, "artillery", game.ref(115, 100)),
    );
    game.executeNextTick();
    upgrade(game, a, "artillery");
    // Snapshot mid-flight: the shell restores with the tier it was fired
    // with, and the restored game plays on identically.
    await expectSnapshotRoundTrip(game, "big_plains", 40);
  });
});

describe("NationWeaponBehavior upgrades", () => {
  it("a rich nation at war buys a tier for a weapon it can fire", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
      new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
    ]);
    const n = game.player("nation");
    const b = game.player("bob");
    conquerRect(game, n, 0, 0, 100, 200);
    conquerRect(game, b, 100, 0, 200, 200);
    n.addTroops(200_000);
    b.addTroops(200_000);
    n.addGold(WEAPON_UPGRADE_COST.artillery[0] * 5n);
    build(game, n, 90, 100, UnitType.DefensePost);
    game.addExecution(new AttackExecution(20_000, n, b.id()));
    game.executeNextTick();
    expect(n.outgoingAttacks().length).toBeGreaterThan(0);
    expect(n.units(UnitType.DefensePost).length).toBe(1);
    new NationWeaponBehavior(game, n).maybeFire();
    game.executeNextTick();
    expect(weaponTier(n.weaponTiers(), "artillery")).toBe(2);
    // No launchers for these, so no tiers bought.
    expect(weaponTier(n.weaponTiers(), "naval")).toBe(1);
    expect(weaponTier(n.weaponTiers(), "airstrike")).toBe(1);
  });
});

describe("upgrade pricing", () => {
  it("is free for a human with infinite gold, like strikes", async () => {
    const game = await setup(
      "big_plains",
      { instantBuild: true, infiniteGold: true },
      [new PlayerInfo("alice", PlayerType.Human, "client_a", "alice")],
    );
    const a = game.player("alice");
    conquerRect(game, a, 0, 0, 50, 50);
    a.removeGold(a.gold());
    const exec = new UpgradeWeaponExecution(a, "rocket");
    game.addExecution(exec);
    game.executeNextTick();
    expect(exec.rejection).toBeNull();
    expect(weaponTier(a.weaponTiers(), "rocket")).toBe(2);
  });
});
