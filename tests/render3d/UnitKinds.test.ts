import { describe, expect, it } from "vitest";
import { ALL_UNIT_TYPES } from "../../src/client/render/types";
import { groupMarkers } from "../../src/client/render3d/units/StructureMarkers";
import {
  arcAt,
  arcPeak,
  flightProgress,
  modelKindFor,
  STRUCTURE_KINDS,
  zoomScale,
  ICON_MODE_OFF,
  ICON_MODE_ON,
  nextIconMode,
} from "../../src/client/render3d/units/UnitKinds";
import {
  ALL_MODEL_KINDS,
  modelGeometry,
} from "../../src/client/render3d/units/UnitModels";

const u = (
  unitType: string,
  trainType: number | null = null,
  loaded: boolean | null = null,
) => ({
  unitType,
  trainType,
  loaded,
});

describe("modelKindFor", () => {
  it("gives every simulation unit type a 3D model", () => {
    for (const t of ALL_UNIT_TYPES) {
      expect(modelKindFor(u(t, 0)), t).not.toBeNull();
    }
  });

  it("resolves trains by car type and load", () => {
    expect(modelKindFor(u("Train", 0))).toBe("trainEngine");
    expect(modelKindFor(u("Train", 1))).toBe("trainEngine");
    expect(modelKindFor(u("Train", 2, false))).toBe("trainCarriage");
    expect(modelKindFor(u("Train", 2, true))).toBe("trainCarriageLoaded");
  });

  it("classifies structures", () => {
    for (const t of [
      "City",
      "Port",
      "Factory",
      "Defense Post",
      "SAM Launcher",
      "Missile Silo",
    ]) {
      expect(STRUCTURE_KINDS.has(modelKindFor(u(t))!)).toBe(true);
    }
  });
});

describe("ballistic flight", () => {
  it("starts and ends on the ground and peaks mid-flight", () => {
    const peak = arcPeak("atomBomb", 200);
    expect(arcAt(peak, 200, 0).height).toBe(0);
    expect(arcAt(peak, 200, 1).height).toBe(0);
    expect(arcAt(peak, 200, 0.5).height).toBeCloseTo(peak);
    expect(arcAt(peak, 200, 0.2).slope).toBeGreaterThan(0);
    expect(arcAt(peak, 200, 0.8).slope).toBeLessThan(0);
  });

  it("shells fly lower than nukes", () => {
    expect(arcPeak("shell", 40)).toBeLessThan(arcPeak("atomBomb", 40));
  });

  it("measures progress by remaining distance", () => {
    expect(flightProgress(0, 0, 0, 0, 100, 0).progress).toBe(0);
    expect(flightProgress(0, 0, 50, 0, 100, 0).progress).toBeCloseTo(0.5);
    expect(flightProgress(0, 0, 100, 0, 100, 0).progress).toBe(1);
    expect(flightProgress(5, 5, 5, 5, 5, 5).progress).toBe(1);
  });

  it("zoom scale never shrinks models below life size", () => {
    expect(zoomScale(10, 70, 16)).toBe(1);
    expect(zoomScale(700, 70, 16)).toBe(10);
    expect(zoomScale(1e6, 70, 16)).toBe(16);
  });
});

describe("UnitModels", () => {
  it("builds every model with team mask and colours", () => {
    for (const kind of ALL_MODEL_KINDS) {
      const g = modelGeometry(kind);
      const n = g.getAttribute("position").count;
      expect(n, kind).toBeGreaterThan(0);
      expect(g.getAttribute("color").count).toBe(n);
      expect(g.getAttribute("normal").count).toBe(n);
      const mask = g.getAttribute("teamMask").array as Float32Array;
      expect(mask.length).toBe(n);
      expect(
        mask.some((v) => v === 1),
        `${kind} has a team-coloured part`,
      ).toBe(kind === "shell" ? false : true);
    }
  });

  it("keeps models compact (low-poly budget)", () => {
    for (const kind of ALL_MODEL_KINDS) {
      expect(
        modelGeometry(kind).getAttribute("position").count,
        kind,
      ).toBeLessThan(3000);
    }
  });
});

describe("2D building icons when zoomed out", () => {
  it("switches to icons far out, back to 3D close in, without flicker", () => {
    let icons = false;
    icons = nextIconMode(icons, 100);
    expect(icons).toBe(false);
    icons = nextIconMode(icons, ICON_MODE_ON + 1);
    expect(icons).toBe(true);
    // Between the two thresholds the current mode is kept.
    const mid = (ICON_MODE_ON + ICON_MODE_OFF) / 2;
    expect(nextIconMode(true, mid)).toBe(true);
    expect(nextIconMode(false, mid)).toBe(false);
    icons = nextIconMode(icons, ICON_MODE_OFF - 1);
    expect(icons).toBe(false);
  });
});

describe("building icon grouping", () => {
  it("merges icons that overlap on screen and keeps separate ones apart", () => {
    const pts: [number, number][] = [
      [100, 100],
      [105, 103], // overlaps the first
      [110, 96], // overlaps the first
      [300, 300], // alone
      [-500, 50], // off screen
    ];
    const groups = groupMarkers(pts.length, (i) => pts[i], 800, 600, 18);
    expect(groups).toEqual([
      { first: 0, count: 3, x: 100, y: 100 },
      { first: 3, count: 1, x: 300, y: 300 },
    ]);
  });

  it("drops markers behind the camera", () => {
    expect(groupMarkers(2, () => null, 800, 600, 18)).toEqual([]);
  });
});
