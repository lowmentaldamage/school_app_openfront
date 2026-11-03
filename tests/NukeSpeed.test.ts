import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { GameConfig } from "@laukolaroser/engine-api/Schemas";
import { EngineConfig } from "@laukolaroser/engine/configuration/EngineConfig";
import { describe, expect, it } from "vitest";

const cfg = new EngineConfig({} as unknown as GameConfig, false);

describe("nukeSpeed", () => {
  it("maps each nuke type to its speed", () => {
    expect(cfg.nukeSpeed(UnitType.AtomBomb)).toBe(10);
    expect(cfg.nukeSpeed(UnitType.HydrogenBomb)).toBe(10);
    expect(cfg.nukeSpeed(UnitType.MIRV)).toBe(15);
    expect(cfg.nukeSpeed(UnitType.MIRVWarhead)).toBe(22);
  });

  it("throws for non-nuke unit types", () => {
    expect(() => cfg.nukeSpeed(UnitType.Warship)).toThrow();
  });
});
