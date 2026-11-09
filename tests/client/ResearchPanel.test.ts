import { withTech } from "@laukolaroser/engine-lib/tech/Tech";
import { EventBus } from "@laukolaroser/shared/EventBus";
import "../../src/client/hud/layers/ResearchPanel";
import type { ResearchPanel } from "../../src/client/hud/layers/ResearchPanel";
import { ToggleResearchPanelEvent } from "../../src/client/InputHandler";
import { ResearchIntentEvent } from "../../src/client/Transport";

function fakeGame(mask: number, research: unknown, gold: bigint) {
  const me = {
    isAlive: () => true,
    techMask: () => mask,
    research: () => research,
    gold: () => gold,
  };
  return {
    myPlayer: () => me,
    inSpawnPhase: () => false,
    ticks: () => 100,
    config: () => ({ gameConfig: () => ({}) }),
  };
}

async function mount(mask: number, research: unknown, gold: bigint) {
  const el = document.createElement("research-panel") as ResearchPanel;
  const bus = new EventBus();
  el.eventBus = bus;
  el.game = fakeGame(mask, research, gold) as never;
  document.body.appendChild(el);
  el.init();
  el.tick();
  await el.updateComplete;
  return { el, bus };
}

describe("ResearchPanel", () => {
  afterEach(() => (document.body.innerHTML = ""));

  test("opens with the key event and starts an available tech", async () => {
    const { el, bus } = await mount(withTech(0, "drill"), null, 10n ** 9n);
    const sent: string[] = [];
    bus.on(ResearchIntentEvent, (e) => sent.push(e.tech));
    bus.emit(new ToggleResearchPanelEvent());
    await el.updateComplete;
    const cards = [...el.querySelectorAll("[role=dialog] button")].filter(
      (b) => !b.textContent?.includes("✕"),
    ) as HTMLButtonElement[];
    expect(cards).toHaveLength(18);
    // Drill is done, Fortification is next in the army branch.
    const enabled = cards.filter((b) => !b.disabled);
    expect(enabled.length).toBe(6); // fortify + the five other line starts
    enabled[0].click();
    expect(sent).toEqual(["fortify"]);
  });

  test("shows progress while researching and blocks a second project", async () => {
    const { el, bus } = await mount(
      0,
      { tech: "trade", endsAt: 250 },
      10n ** 9n,
    );
    expect(el.textContent).toContain("50%");
    bus.emit(new ToggleResearchPanelEvent());
    await el.updateComplete;
    const enabled = [...el.querySelectorAll("[role=dialog] button")].filter(
      (b) =>
        !(b as HTMLButtonElement).disabled && !b.textContent?.includes("✕"),
    );
    expect(enabled).toHaveLength(0);
  });
});
