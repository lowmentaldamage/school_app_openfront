import {
  PlayerType,
  TerrainType,
} from "@laukolaroser/engine-api/game/GameTypes";
import { GameConfig } from "@laukolaroser/engine-api/Schemas";
import {
  EngineConfig,
  highGroundModifier,
} from "@laukolaroser/engine/configuration/EngineConfig";

describe("high ground", () => {
  it("uphill or unknown origin pays full price", () => {
    expect(highGroundModifier(TerrainType.Mountain, TerrainType.Plains)).toBe(
      1,
    );
    expect(highGroundModifier(TerrainType.Mountain, undefined)).toBe(1);
    expect(highGroundModifier(TerrainType.Highland, TerrainType.Plains)).toBe(
      1,
    );
  });

  it("along a ridge and downhill is cheaper; plains unchanged", () => {
    expect(highGroundModifier(TerrainType.Mountain, TerrainType.Mountain)).toBe(
      0.75,
    );
    expect(highGroundModifier(TerrainType.Plains, TerrainType.Mountain)).toBe(
      0.85,
    );
    expect(highGroundModifier(TerrainType.Plains, TerrainType.Plains)).toBe(1);
  });
});

describe("mountains are hard to invade", () => {
  it("cost far more troops and time than plains", () => {
    // The real rules (test games stub attackLogic).
    const cfg = new EngineConfig({} as GameConfig, false);
    const input = (terrain: TerrainType, from?: TerrainType) => ({
      terrain,
      attackerTerrain: from,
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
      falloutRatio: null,
      borderSize: 100,
    });
    const plains = cfg.attackLogic(
      input(TerrainType.Plains, TerrainType.Plains),
    );
    const mountain = cfg.attackLogic(
      input(TerrainType.Mountain, TerrainType.Plains),
    );
    expect(mountain.attackerTroopLoss).toBeGreaterThan(
      plains.attackerTroopLoss * 2.5,
    );
    // Slower too: each mountain tile uses more of the front's per-tick budget.
    expect(mountain.tickFraction).toBeGreaterThan(plains.tickFraction * 2);

    // Holding a peak makes the next one easier than assaulting from below.
    const ridge = cfg.attackLogic(
      input(TerrainType.Mountain, TerrainType.Mountain),
    );
    expect(ridge.attackerTroopLoss).toBeLessThan(mountain.attackerTroopLoss);
  });
});
