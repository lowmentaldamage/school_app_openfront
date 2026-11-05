import {
  DISASTER_KINDS,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import { GameUpdateType } from "@laukolaroser/engine-api/game/GameUpdates";
import {
  DISASTER_INTERVAL,
  DISASTER_WEIGHTS,
  DISASTERS,
  disasterKindOrder,
  disasterGap,
  disasterTroopLoss,
  GRACE_TICKS,
  LOSS_CAP_PERCENT,
  WARNING_TICKS,
} from "@laukolaroser/engine-lib/disasters/Disasters";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import {
  DisasterExecution,
  disasterFrequency,
} from "@laukolaroser/engine/execution/DisasterExecution";
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
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
}

async function world(
  disasters: "off" | "rare" | "normal" | "frequent" = "normal",
) {
  const game = await setup("big_plains", { instantBuild: true, disasters }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  ]);
  const a = game.player("alice");
  const b = game.player("bob");
  conquerRect(game, a, 0, 0, 100, 200);
  conquerRect(game, b, 100, 0, 200, 200);
  a.addTroops(100_000);
  b.addTroops(100_000);
  a.addGold(10_000_000n);
  while (game.inSpawnPhase()) game.executeNextTick();
  return { game, a, b };
}

function disasterUpdates(game: Game, ticks: number) {
  const out: { phase: string; kind: string }[] = [];
  for (let i = 0; i < ticks; i++) {
    const u = game.executeNextTick();
    for (const d of u[GameUpdateType.DisasterEvent] ?? []) {
      out.push({ phase: d.phase, kind: d.kind });
    }
  }
  return out;
}

describe("disaster rules", () => {
  it("gaps stay within ±30% of the average", () => {
    for (const f of ["rare", "normal", "frequent"] as const) {
      const avg = DISASTER_INTERVAL[f];
      expect(disasterGap(f, 0)).toBeGreaterThanOrEqual(Math.floor(avg * 0.7));
      expect(disasterGap(f, 999)).toBeLessThanOrEqual(Math.ceil(avg * 1.3));
    }
  });

  it("never takes more than the cap of an army, in integers", () => {
    for (const k of DISASTER_KINDS) {
      const spec = DISASTERS[k];
      let total = 0;
      let troops = 100_000;
      for (let p = 0; p < spec.pulses; p++) {
        const loss = disasterTroopLoss(spec, troops, 100, 100);
        expect(Number.isInteger(loss)).toBe(true);
        total += loss;
        troops -= loss;
      }
      expect(total).toBeLessThanOrEqual((100_000 * LOSS_CAP_PERCENT) / 100);
      expect(disasterTroopLoss(spec, 100_000, 1000, 0)).toBe(0);
    }
  });
});

describe("DisasterExecution", () => {
  it("is off unless the game option is set, and off in the tutorial", async () => {
    expect(disasterFrequency(await setup("big_plains", {}))).toBe("off");
    expect(disasterFrequency((await world("off")).game)).toBe("off");
    expect(disasterFrequency((await world("frequent")).game)).toBe("frequent");
    const tut = await setup("big_plains", {
      disasters: "normal",
      tutorial: true,
    });
    expect(disasterFrequency(tut)).toBe("off");
  });

  it("schedules a disaster after the grace period, warns, then strikes", async () => {
    const { game } = await world("frequent");
    const exec = new DisasterExecution();
    game.addExecution(exec);
    const updates = disasterUpdates(
      game,
      GRACE_TICKS + Math.ceil(DISASTER_INTERVAL.frequent * 1.3) + 200,
    );
    const warning = updates.findIndex((u) => u.phase === "warning");
    const strike = updates.findIndex((u) => u.phase === "strike");
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(strike).toBeGreaterThan(warning);
    expect(updates[strike].kind).toBe(updates[warning].kind);
  });

  it("an earthquake costs troops in the area but never land", async () => {
    const { game, a, b } = await world();
    const exec = new DisasterExecution();
    game.addExecution(exec);
    game.executeNextTick();
    const tilesA = a.numTilesOwned();
    const tilesB = b.numTilesOwned();
    const troopsB = b.troops();
    exec.announce(game.ticks(), "earthquake", game.ref(150, 100));
    executeTicks(game, WARNING_TICKS + 2);
    expect(exec.lastResult?.troopsKilled ?? 0).toBeGreaterThan(0);
    expect(b.troops()).toBeLessThan(troopsB);
    expect(b.troops()).toBeGreaterThanOrEqual(
      Math.floor(troopsB * (1 - LOSS_CAP_PERCENT / 100)) - 1,
    );
    expect(a.numTilesOwned()).toBe(tilesA);
    expect(b.numTilesOwned()).toBe(tilesB);
  });

  it("a volcano wrecks buildings near it", async () => {
    const { game, a } = await world();
    for (const [x, y] of [
      [48, 100],
      [52, 100],
      [50, 96],
      [50, 104],
    ]) {
      game.addExecution(
        new ConstructionExecution(a, UnitType.City, game.ref(x, y)),
      );
    }
    executeTicks(game, 4);
    const before = a.units(UnitType.City).reduce((s, u) => s + u.level(), 0);
    expect(before).toBeGreaterThan(0);
    const exec = new DisasterExecution();
    game.addExecution(exec);
    game.executeNextTick();
    exec.announce(game.ticks(), "volcano", game.ref(50, 100));
    executeTicks(game, WARNING_TICKS + 2);
    const after = a.units(UnitType.City).reduce((s, u) => s + u.level(), 0);
    expect(after).toBeLessThan(before);
    expect(exec.lastResult!.buildingsHit).toBeGreaterThan(0);
  });

  it("is deterministic and survives a snapshot mid-warning", async () => {
    const { game } = await world();
    const exec = new DisasterExecution();
    game.addExecution(exec);
    game.executeNextTick();
    exec.announce(game.ticks(), "wildfire", game.ref(150, 100));
    executeTicks(game, 10);
    await expectSnapshotRoundTrip(game, "big_plains", WARNING_TICKS + 100);
  });
});

describe("trigger_disaster (test button)", () => {
  it("in a solo game sets off the chosen disaster at once, after the warning", async () => {
    const game = await setup(
      "big_plains",
      { instantBuild: true, gameType: GameType.Singleplayer },
      [new PlayerInfo("alice", PlayerType.Human, "client_a", "alice")],
    );
    const a = game.player("alice");
    conquerRect(game, a, 0, 0, 100, 200);
    a.addTroops(100_000);
    while (game.inSpawnPhase()) game.executeNextTick();
    const exec = new DisasterExecution(a, "earthquake");
    game.addExecution(exec);
    const updates = disasterUpdates(game, WARNING_TICKS + 5);
    expect(exec.refused).toBe(false);
    expect(updates.map((u) => `${u.kind}:${u.phase}`)).toEqual([
      "earthquake:warning",
      "earthquake:strike",
    ]);
    expect(exec.isActive()).toBe(false);
  });

  it("is refused in multiplayer without host cheats", async () => {
    const game = await setup(
      "big_plains",
      { instantBuild: true, gameType: GameType.Public },
      [
        new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
        new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
      ],
    );
    const a = game.player("alice");
    conquerRect(game, a, 0, 0, 100, 200);
    while (game.inSpawnPhase()) game.executeNextTick();
    const exec = new DisasterExecution(a, "volcano");
    game.addExecution(exec);
    const updates = disasterUpdates(game, 5);
    expect(exec.refused).toBe(true);
    expect(updates).toEqual([]);
  });
});

describe("disasterKindOrder", () => {
  it("picks kinds by weight and always lists every kind once", () => {
    const firsts: Record<string, number> = {};
    for (let r = 0; r < 1000; r++) {
      const order = disasterKindOrder(r);
      expect(new Set(order).size).toBe(DISASTER_KINDS.length);
      firsts[order[0]] = (firsts[order[0]] ?? 0) + 1;
    }
    for (const k of DISASTER_KINDS) {
      expect(firsts[k]).toBeCloseTo(DISASTER_WEIGHTS[k] * 10, -1);
    }
  });
});
