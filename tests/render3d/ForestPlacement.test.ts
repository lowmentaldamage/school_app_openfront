import { describe, expect, it } from "vitest";
import { placeTrees } from "../../src/client/render3d/environment/ForestPlacement";
import { Heightfield } from "../../src/client/render3d/terrain/Heightfield";
import { loadTestTerrain } from "./util";

describe("placeTrees", () => {
  it("is deterministic and only plants on land", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const a = placeTrees(terrain, hf, { stride: 3, density: 1 });
    const b = placeTrees(terrain, hf, { stride: 3, density: 1 });
    expect(a.length).toBe(b.length);
    expect(a[100]).toEqual(b[100]);
    for (const t of a) {
      expect(map.isLand(map.ref(Math.floor(t.x), Math.floor(t.y)))).toBe(true);
    }
  });

  it("stays within a sane budget and thins with stride", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const dense = placeTrees(terrain, hf, { stride: 3, density: 1 }).length;
    const sparse = placeTrees(terrain, hf, { stride: 5, density: 1 }).length;
    expect(dense).toBeGreaterThan(2000);
    expect(dense).toBeLessThan(60000);
    expect(sparse).toBeLessThan(dense);
  });
});
