import { LAND_BIT } from "../../src/client/render3d/terrain/TerrainCodec";
import {
  buildTerrainDetail,
  detailHeightfield,
  detailScaleFor,
  upscaleTerrainDetail,
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

describe("upscaleTerrainDetail", () => {
  // Random-ish coastline with single-tile islands and one-tile straits.
  const w = 24;
  const h = 18;
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const land = (x * 7 + y * 13) % 5 < 2 || x < 6;
      terrain[y * w + x] = land ? LAND_BIT | ((x * y) % 30) : 2;
    }
  }
  const base = buildTerrainDetail(terrain, detailHeightfield(terrain, w, h));
  const up = upscaleTerrainDetail(base, 2);

  test("doubles the resolution", () => {
    expect(up.width).toBe(w * 2);
    expect(up.height).toBe(h * 2);
    expect(up.scale).toBe(2);
    expect(up.values).toHaveLength(w * h * 4 * 2);
  });

  test("every sub-texel stays on its tile's side of the coastline", () => {
    for (let Y = 0; Y < up.height; Y++) {
      for (let X = 0; X < up.width; X++) {
        const tileLand = terrain[(Y >> 1) * w + (X >> 1)] >= LAND_BIT;
        const o = (Y * up.width + X) * 2;
        if (tileLand) {
          expect(up.values[o + 1]).toBeGreaterThan(0.5);
          expect(up.values[o]).toBeGreaterThan(0);
        } else {
          expect(up.values[o + 1]).toBeLessThan(0.5);
          expect(up.values[o]).toBeLessThan(0);
        }
      }
    }
  });

  test("is deterministic", () => {
    const again = upscaleTerrainDetail(base, 2);
    expect(Array.from(again.values)).toEqual(Array.from(up.values));
  });

  test("scale 1 returns the native data", () => {
    expect(upscaleTerrainDetail(base, 1)).toBe(base);
  });

  test("detailScaleFor respects texture size and budget", () => {
    expect(detailScaleFor(2000, 1000, 8192, 9_000_000)).toBe(2);
    expect(detailScaleFor(2000, 1000, 2048, 9_000_000)).toBe(1);
    expect(detailScaleFor(4744, 2628, 16384, 9_000_000)).toBe(1);
    expect(detailScaleFor(2000, 1000, 8192, 0)).toBe(1);
  });
});
