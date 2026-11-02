import { LAND_BIT } from "../../src/client/render3d/terrain/TerrainCodec";
import {
  buildTerrainDetail,
  detailHeightfield,
} from "../../src/client/render3d/terrain/TerrainDetail";

describe("TerrainDetail", () => {
  // 6x4: left half land (rising elevation), right half water.
  const w = 6;
  const h = 4;
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      terrain[y * w + x] = x < 3 ? LAND_BIT | (x * 8) : 2;
    }
  }

  test("keeps one [height, land] pair per tile at full resolution", () => {
    const d = buildTerrainDetail(terrain, detailHeightfield(terrain, w, h));
    expect(d.width).toBe(w);
    expect(d.height).toBe(h);
    expect(d.values).toHaveLength(w * h * 2);
  });

  test("land mask follows the tiles exactly", () => {
    const d = buildTerrainDetail(terrain, detailHeightfield(terrain, w, h));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        expect(d.values[(y * w + x) * 2 + 1]).toBe(x < 3 ? 1 : 0);
      }
    }
  });

  test("heights keep land above and water below sea level", () => {
    const d = buildTerrainDetail(terrain, detailHeightfield(terrain, w, h));
    for (let i = 0; i < w * h; i++) {
      const height = d.values[i * 2];
      if (d.values[i * 2 + 1] === 1) expect(height).toBeGreaterThan(0);
      else expect(height).toBeLessThan(0);
    }
  });

  test("is less smoothed than the mesh heightfield (keeps relief)", () => {
    const tall = new Uint8Array(9 * 9).fill(LAND_BIT);
    tall[4 * 9 + 4] = LAND_BIT | 28; // one mountain tile
    const d = buildTerrainDetail(tall, detailHeightfield(tall, 9, 9));
    const peak = d.values[(4 * 9 + 4) * 2];
    const flat = d.values[0];
    expect(peak - flat).toBeGreaterThan(0.5);
  });
});
