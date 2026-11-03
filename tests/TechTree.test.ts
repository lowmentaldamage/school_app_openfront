import {
  Difficulty,
  MessageType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@laukolaroser/engine-api/game/GameTypes";
import {
  hasTech,
  researchBlock,
  TECH_EFFECTS,
  TECHS,
  techSpec,
  techsOf,
  withTech,
} from "@laukolaroser/engine-lib/tech/Tech";
import { ConstructionExecution } from "@laukolaroser/engine/execution/ConstructionExecution";
import { NationTechBehavior } from "@laukolaroser/engine/execution/nation/NationTechBehavior";
import { ResearchExecution } from "@laukolaroser/engine/execution/ResearchExecution";
import { Game, Player } from "@laukolaroser/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

function conquerRect(game: Game, p: Player, x1: number, y1: number) {
  for (let y = 0; y < y1; y++)
    for (let x = 0; x < x1; x++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
}

async function oneHuman(config: Record<string, unknown> = {}) {
  const game = await setup("plains", { instantBuild: true, ...config }, [
    new PlayerInfo("a", PlayerType.Human, "a", "a"),
  ]);
  const a = game.player("a");
  conquerRect(game, a, 60, 60);
  a.addGold(10_000_000n);
  executeTicks(game, 2);
  return { game, a };
}

function research(game: Game, p: Player, tech: (typeof TECHS)[number]["id"]) {
  const exec = new ResearchExecution(p, tech);
  game.addExecution(exec);
  game.executeNextTick();
  return exec;
}

describe("tech rules", () => {
  test("tiers need the previous tier of their branch", () => {
    expect(researchBlock("fortify", 0, null, 10n ** 9n, true)).toBe("locked");
    const m = withTech(0, "drill");
    expect(researchBlock("fortify", m, null, 10n ** 9n, true)).toBeNull();
    expect(researchBlock("drill", m, null, 10n ** 9n, true)).toBe("researched");
    expect(researchBlock("gunnery", m, "fortify", 10n ** 9n, true)).toBe(
      "busy",
    );
    expect(researchBlock("gunnery", m, null, 1n, true)).toBe("gold");
    expect(researchBlock("gunnery", m, null, 10n ** 9n, false)).toBe(
      "disabled",
    );
    expect(techsOf(m)).toEqual(["drill"]);
    expect(hasTech(m, "gunnery")).toBe(false);
    for (const t of TECHS) {
      if (t.requires) expect(techSpec(t.requires).tier).toBe(t.tier - 1);
    }
  });
});

describe("research", () => {
  test("costs gold, takes time, then completes with a message", async () => {
    const { game, a } = await oneHuman();
    const gold = a.gold();
    const exec = research(game, a, "drill");
    expect(exec.rejection).toBeNull();
    expect(a.gold()).toBe(gold - techSpec("drill").cost);
    expect(a.research()?.tech).toBe("drill");
    // A second project is refused while one runs.
    expect(research(game, a, "gunnery").rejection).toBe("busy");
    const spy = vi.spyOn(game, "displayMessage");
    executeTicks(game, techSpec("drill").ticks - 3);
    expect(a.hasTech("drill")).toBe(false);
    executeTicks(game, 5);
    expect(a.hasTech("drill")).toBe(true);
    expect(a.research()).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      "events_display.research_done_drill",
      MessageType.RESEARCH_COMPLETE,
      a.id(),
    );
    // Exposed for the player update.
    expect(a.techMask()).toBe(withTech(0, "drill"));
  });

  test("can be switched off in the lobby", async () => {
    const { game, a } = await oneHuman({ disableTechTree: true });
    expect(research(game, a, "drill").rejection).toBe("disabled");
  });

  test("snapshot round trip mid-research", async () => {
    const { game, a } = await oneHuman();
    research(game, a, "trade");
    executeTicks(game, 10);
    await expectSnapshotRoundTrip(game, "plains", 20);
  });
});

describe("tech effects", () => {
  test("Conscription speeds up troop growth", async () => {
    const { game, a } = await oneHuman();
    const before = game.config().troopIncreaseRate(a);
    (a as unknown as { _techMask: number })._techMask = withTech(
      0,
      "conscription",
    );
    const after = game.config().troopIncreaseRate(a);
    expect(after).toBeGreaterThan(before);
  });

  test("Construction makes buildings cheaper, not nukes", async () => {
    const { game, a } = await oneHuman();
    const poor = await setup("plains", {}, [
      new PlayerInfo("b", PlayerType.Human, "b", "b"),
    ]);
    const b = poor.player("b");
    const city = () => poor.unitInfo(UnitType.City).cost(poor, b);
    const nuke = () => poor.unitInfo(UnitType.AtomBomb).cost(poor, b);
    const c0 = city();
    const n0 = nuke();
    (b as unknown as { _techMask: number })._techMask = withTech(
      0,
      "construction",
    );
    expect(city()).toBe(
      (c0 * BigInt(TECH_EFFECTS.constructionCostPercent)) / 100n,
    );
    expect(nuke()).toBe(n0);
    void game;
    void a;
  });

  test("Industrialization raises income building pay", async () => {
    const pay = async (withIndustry: boolean) => {
      const { game, a } = await oneHuman();
      if (withIndustry) {
        (a as unknown as { _techMask: number })._techMask = withTech(
          0,
          "industry",
        );
      }
      game.addExecution(
        new ConstructionExecution(a, UnitType.Market, game.ref(30, 30)),
      );
      executeTicks(game, 3);
      const g = a.gold();
      executeTicks(game, 100);
      return a.gold() - g;
    };
    const base = await pay(false);
    const more = await pay(true);
    expect(more).toBeGreaterThan(base);
  });
});

describe("NationTechBehavior", () => {
  test("rich nations research, poor or easy ones do not", async () => {
    const game = await setup(
      "plains",
      { instantBuild: true, difficulty: Difficulty.Hard },
      [new PlayerInfo("n", PlayerType.Nation, null, "n")],
    );
    const n = game.player("n");
    conquerRect(game, n, 40, 40);
    const ai = new NationTechBehavior(game, n);
    for (let i = 0; i < 100; i++) {
      ai.maybeResearch();
      game.executeNextTick();
    }
    expect(n.research()).toBeNull();
    expect(n.techMask()).toBe(0);
    n.addGold(100_000_000n);
    for (let i = 0; i < 2000; i++) {
      if (i % 10 === 0) ai.maybeResearch();
      game.executeNextTick();
    }
    expect(techsOf(n.techMask()).length).toBeGreaterThan(1);
  });
});
