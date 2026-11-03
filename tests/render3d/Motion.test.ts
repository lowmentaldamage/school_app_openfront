import {
  airAltitude,
  airClimbPitch,
  bankFor,
  BUILD_RISE_MS,
  buildRise,
  smoothTo,
  turnRate,
  turnToward,
  wrapAngle,
} from "../../src/client/render3d/units/Motion";

describe("Motion", () => {
  test("wrapAngle keeps angles in (-π, π]", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(-0.5 - 2 * Math.PI)).toBeCloseTo(-0.5);
  });

  test("turnToward takes the short way and never overshoots", () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
    // From +170° to -170° goes through 180°, not back through 0.
    const a = turnToward((170 * Math.PI) / 180, (-170 * Math.PI) / 180, 0.1);
    expect(Math.abs(a)).toBeGreaterThan((170 * Math.PI) / 180);
  });

  test("big ships turn slower than destroyers and fighters", () => {
    expect(turnRate("battleship")).toBeLessThan(turnRate("destroyer"));
    expect(turnRate("bomber")).toBeLessThan(turnRate("fighter"));
    expect(turnRate("trainEngine")).toBeGreaterThan(turnRate("fighter"));
  });

  test("planes bank harder than ships and both are clamped", () => {
    expect(Math.abs(bankFor(true, 1))).toBeGreaterThan(
      Math.abs(bankFor(false, 1)),
    );
    expect(Math.abs(bankFor(true, 100))).toBeLessThanOrEqual(0.75);
    expect(Math.abs(bankFor(false, 100))).toBeLessThanOrEqual(0.18);
    expect(Math.sign(bankFor(true, 1))).toBe(-Math.sign(bankFor(false, 1)));
  });

  test("smoothTo approaches the target without overshoot", () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = smoothTo(v, 1, 0.016, 0.3);
    expect(v).toBeGreaterThan(0.95);
    expect(v).toBeLessThanOrEqual(1);
    expect(smoothTo(0.3, 1, 0, 0.3)).toBe(0.3);
  });

  test("aircraft climb out of their base and cruise", () => {
    expect(airAltitude(0, 9)).toBeLessThan(1);
    expect(airAltitude(3, 9)).toBeGreaterThan(airAltitude(1, 9));
    expect(airAltitude(20, 9)).toBeCloseTo(9);
    expect(airClimbPitch(3, 9, true)).toBeGreaterThan(0);
    expect(airClimbPitch(3, 9, false)).toBeLessThan(0);
    expect(airClimbPitch(20, 9, true)).toBe(0);
  });

  test("buildings rise with a small overshoot and settle at full height", () => {
    expect(buildRise(0)).toBeLessThan(0.1);
    let peak = 0;
    for (let t = 0; t <= BUILD_RISE_MS; t += 10)
      peak = Math.max(peak, buildRise(t));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
    expect(buildRise(BUILD_RISE_MS)).toBe(1);
    expect(buildRise(10_000)).toBe(1);
  });
});

describe("metroFactors", () => {
  test("nearby cities of one owner grow; others don't", async () => {
    const { metroFactors } =
      await import("../../src/client/render3d/units/UnitRenderer");
    const W = 100;
    const city = (id: number, owner: number, x: number, y: number) => ({
      id,
      unitType: "City",
      ownerID: owner,
      pos: y * W + x,
      isActive: true,
    });
    const f = metroFactors(
      [
        city(1, 1, 10, 10),
        city(2, 1, 12, 11),
        city(3, 1, 13, 13),
        city(4, 2, 11, 10), // other owner: no merge
        city(5, 1, 60, 60), // far away
      ],
      W,
    );
    expect(f.get(1)).toBeCloseTo(1.3);
    expect(f.get(2)).toBeCloseTo(1.3);
    expect(f.get(4)).toBeUndefined();
    expect(f.get(5)).toBeUndefined();
  });
});

describe("seaLifeSpots", () => {
  test("boats and gulls sit in shallow coastal water, same every time", async () => {
    const { seaLifeSpots } =
      await import("../../src/client/render3d/environment/SeaLife");
    const { Heightfield } =
      await import("../../src/client/render3d/terrain/Heightfield");
    const { loadTestTerrain } = await import("./util");
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const a = seaLifeSpots(hf, 50);
    const b = seaLifeSpots(hf, 50);
    expect(a.length).toBe(50);
    expect(a).toEqual(b);
    for (const s of a) {
      const h = hf.sample(s.x, s.z);
      expect(h).toBeLessThan(0);
      expect(h).toBeGreaterThan(-2.3);
    }
  });
});
