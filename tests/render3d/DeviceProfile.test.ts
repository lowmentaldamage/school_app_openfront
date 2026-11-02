import { describe, expect, it } from "vitest";
import { QUALITY_LEVELS } from "../../src/client/render3d/AdaptiveQuality";
import { profileFor } from "../../src/client/render3d/DeviceProfile";
import { baseStrideFor } from "../../src/client/render3d/terrain/TerrainRenderer";

describe("DeviceProfile", () => {
  it("treats touch phones as mobile with lighter budgets", () => {
    const phone = profileFor({
      coarsePointer: true,
      maxTouchPoints: 5,
      screenShortSide: 412,
    });
    const desktop = profileFor({
      coarsePointer: false,
      maxTouchPoints: 0,
      screenShortSide: 1080,
    });
    expect(phone.mobile).toBe(true);
    expect(desktop.mobile).toBe(false);
    expect(phone.antialias).toBe(false);
    expect(phone.terrainVertexBudget).toBeLessThan(desktop.terrainVertexBudget);
    expect(phone.initialQuality).toBeLessThan(desktop.initialQuality);
    expect(QUALITY_LEVELS[phone.initialQuality].shadows).toBe(false);
    expect(
      QUALITY_LEVELS[phone.initialQuality].pixelRatioCap,
    ).toBeLessThanOrEqual(1);
  });

  it("honours the UA-CH mobile hint", () => {
    expect(
      profileFor({
        coarsePointer: false,
        maxTouchPoints: 0,
        screenShortSide: 1200,
        uaMobile: true,
      }).mobile,
    ).toBe(true);
  });

  it("touch laptops with large screens stay on the desktop profile", () => {
    expect(
      profileFor({
        coarsePointer: true,
        maxTouchPoints: 10,
        screenShortSide: 1080,
      }).mobile,
    ).toBe(false);
  });

  it("the mobile vertex budget coarsens the terrain on large maps", () => {
    expect(baseStrideFor(4744, 2628, 600_000)).toBeGreaterThan(
      baseStrideFor(4744, 2628),
    );
  });
});
