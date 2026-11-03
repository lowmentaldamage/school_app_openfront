import type { UserMeResponse } from "@laukolaroser/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";

vi.mock("../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    start(): void {}
    stop(): void {}
  },
}));

const lastBroadcast = vi.hoisted(() => ({
  current: null as { response: UserMeResponse | false } | null,
}));

vi.mock("../../src/client/UserMeBroadcast", () => ({
  lastUserMeResponse: () => lastBroadcast.current,
}));

// Registers <game-mode-selector> as a side effect.
import "../../src/client/GameModeSelector";

type Selector = HTMLElement & { updateComplete: Promise<unknown> };

function me(trustTier: "trusted" | "untrusted"): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: { trustTier },
  } as unknown as UserMeResponse;
}

async function mount(): Promise<Selector> {
  const selector = document.createElement("game-mode-selector") as Selector;
  document.body.appendChild(selector);
  await selector.updateComplete;
  return selector;
}

async function broadcast(
  selector: Selector,
  response: UserMeResponse | false,
): Promise<void> {
  document.dispatchEvent(
    new CustomEvent("userMeResponse", { detail: response }),
  );
  await selector.updateComplete;
}

beforeEach(() => {
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "",
    jwtAudience: "test",
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();
  lastBroadcast.current = null;
});

afterEach(() => {
  document.body.innerHTML = "";
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
});

// Laukolaroser has no ranked play (it needs the closed upstream API), so
// the home screen offers Create and Join only, for every kind of viewer.
describe("Ranked button", () => {
  for (const viewer of ["signed out", "untrusted", "trusted"] as const) {
    it(`is not shown to a ${viewer} viewer`, async () => {
      const selector = await mount();
      if (viewer !== "signed out") await broadcast(selector, me(viewer));
      const labels = Array.from(selector.querySelectorAll("button")).map(
        (b) => b.textContent?.trim().toLowerCase() ?? "",
      );
      expect(labels.some((t) => t.includes("ranked"))).toBe(false);
      expect(selector.querySelector("[data-trust]")).toBeNull();
    });
  }
});
