import { describe, expect, it } from "vitest";
import {
  arcPeak,
  ballisticPose,
  PATROL_RADIUS,
  patrolPose,
} from "../../src/client/render3d/units/UnitKinds";

describe("ballisticPose", () => {
  const flat = () => 0;

  it("flies a straight ground track, whatever curve the 2D path takes", () => {
    // Engine path bulges sideways; the drawn track stays on the line.
    const p = ballisticPose("atomBomb", 0, 0, 50, 20, 100, 0, flat);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeGreaterThan(40);
    expect(p.yaw).toBeCloseTo(0, 6);
  });

  it("peaks mid-flight and lands on the target", () => {
    const mid = ballisticPose("atomBomb", 0, 0, 50, 0, 100, 0, flat);
    expect(mid.h).toBeCloseTo(arcPeak("atomBomb", 100) + 0.5, 4);
    expect(Math.abs(mid.pitch)).toBeLessThan(1e-6);
    const end = ballisticPose("atomBomb", 0, 0, 100, 0, 100, 0, flat);
    expect(end.h).toBeCloseTo(0.5, 6);
    const start = ballisticPose("atomBomb", 0, 0, 0, 0, 100, 0, flat);
    expect(start.pitch).toBeGreaterThan(0.5);
  });

  it("does not bob over mountains under the flight path", () => {
    // A tall ridge in the middle of a flat map.
    const ridge = (x: number) => (x > 40 && x < 60 ? 30 : 0);
    const hs: number[] = [];
    for (let x = 0; x <= 100; x += 5) {
      hs.push(ballisticPose("atomBomb", 0, 0, x, 0, 100, 0, ridge).h);
    }
    // Smooth arc: rises to the middle, then falls.
    for (let i = 1; i < hs.length; i++) {
      if (i <= 10) expect(hs[i]).toBeGreaterThanOrEqual(hs[i - 1] - 1e-9);
      else expect(hs[i]).toBeLessThanOrEqual(hs[i - 1] + 1e-9);
    }
  });

  it("flies between launch and target ground heights", () => {
    const hill = (x: number) => (x > 90 ? 10 : 0);
    const end = ballisticPose("atomBomb", 0, 0, 100, 0, 100, 0, hill);
    expect(end.h).toBeCloseTo(10.5, 6);
  });
});

describe("ballisticPose clears mountains", () => {
  it("arcs over a ridge taller than the normal peak", () => {
    const ridge = (x: number) => (x > 30 && x < 70 ? 60 : 0);
    for (let x = 0; x <= 100; x += 2) {
      const p = ballisticPose("atomBomb", 0, 0, x, 0, 100, 0, ridge);
      expect(p.h).toBeGreaterThan(ridge(x));
    }
  });
});

describe("patrolPose", () => {
  it("circles the airbase, the two fighters opposite each other", () => {
    for (const t of [0, 1.3, 7.9]) {
      const a = patrolPose(50, 60, 0, 3, t);
      const b = patrolPose(50, 60, 1, 3, t);
      expect(Math.hypot(a.x - 50, a.z - 60)).toBeCloseTo(PATROL_RADIUS, 6);
      // Opposite sides of the base.
      expect((a.x - 50) * (b.x - 50) + (a.z - 60) * (b.z - 60)).toBeLessThan(0);
    }
  });

  it("heading points along the direction of flight", () => {
    const t = 2;
    const p0 = patrolPose(0, 0, 0, 0, t);
    const p1 = patrolPose(0, 0, 0, 0, t + 0.01);
    const yaw = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
    expect(Math.cos(yaw - p0.yaw)).toBeGreaterThan(0.999);
  });
});
