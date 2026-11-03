import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { buildHelp, stackingTip } from "../../src/client/hud/BuildHelp";

const rules = {
  cityTroopIncrease: () => 250_000,
  defensePostRange: () => 30,
  samRange: (l: number) => 150 - 480 / (l + 5),
  nukeMagnitudes: (t: UnitType) =>
    t === UnitType.HydrogenBomb
      ? { inner: 80, outer: 100 }
      : { inner: 12, outer: 30 },
  trainStationMaxRange: () => 110,
};

const text = (t: UnitType) =>
  JSON.stringify(buildHelp(t, rules)?.stats.map((s) => s.value));

describe("BuildHelp", () => {
  test("income buildings show exact gold per minute", () => {
    expect(text(UnitType.GoldMine)).toContain("24.0K");
    expect(text(UnitType.GoldMine)).toContain("36.0K"); // on a mountain
    expect(text(UnitType.Market)).toContain("15.0K");
    expect(text(UnitType.OilRig)).toContain("42.0K");
  });

  test("defence numbers come from the rules", () => {
    expect(text(UnitType.City)).toContain("250K");
    expect(text(UnitType.DefensePost)).toContain("30");
    expect(text(UnitType.SAMLauncher)).toContain("70 → 102");
    expect(text(UnitType.HydrogenBomb)).toContain("80 / 100");
  });

  test("every bar item has help and a stacking tip", () => {
    for (const t of [
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.GoldMine,
      UnitType.Market,
      UnitType.OilRig,
      UnitType.Airbase,
      UnitType.RadarStation,
      UnitType.Warship,
      UnitType.Submarine,
      UnitType.Carrier,
      UnitType.AtomBomb,
      UnitType.MIRV,
      UnitType.ArmoredTrain,
    ]) {
      expect(buildHelp(t, rules)?.use.length).toBeGreaterThan(5);
      expect(stackingTip(t).length).toBeGreaterThan(5);
    }
  });
});
