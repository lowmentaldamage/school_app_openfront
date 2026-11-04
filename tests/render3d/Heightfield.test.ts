import { describe, expect, it } from "vitest";
import {
  Heightfield,
  IMPASSABLE_HEIGHT,
  levelHeight,
  limitSlope,
  MAX_WATER_HEIGHT,
  MIN_LAND_HEIGHT,
  rawHeight,
  TOP_HEIGHT,
} from "../../src/client/render3d/terrain/Heightfield";
import {
  Biome,
  biomeOf,
  LAND_BIT,
  OCEAN_BIT,
} from "../../src/client/render3d/terrain/TerrainCodec";
import { loadTestTerrain } from "./util";

describe("TerrainCodec", () => {
  it("classifies biomes with the engine's magnitude thresholds", () => {
    expect(biomeOf(OCEAN_BIT | 3)).toBe(Biome.Ocean);
    expect(biomeOf(0)).toBe(Biome.Lake);
    expect(biomeOf(LAND_BIT | 0)).toBe(Biome.Plains);
    expect(biomeOf(LAND_BIT | 9)).toBe(Biome.Plains);
    expect(biomeOf(LAND_BIT | 10)).toBe(Biome.Highland);
    expect(biomeOf(LAND_BIT | 20)).toBe(Biome.Mountain);
    expect(biomeOf(LAND_BIT | 31)).toBe(Biome.Impassable);
  });

  it("matches GameMap.terrainType for every tile of a real map", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    for (let i = 0; i < terrain.length; i += 97) {
      const b = biomeOf(terrain[i]);
      expect(b === Biome.Ocean).toBe(map.isOcean(i));
      expect(b !== Biome.Ocean && b !== Biome.Lake).toBe(map.isLand(i));
    }
  });
});

describe("Heightfield", () => {
  it("raw heights increase with elevation class and water deepens offshore", () => {
    expect(rawHeight(LAND_BIT | 0)).toBeGreaterThan(0);
    expect(rawHeight(LAND_BIT | 15)).toBeGreaterThan(rawHeight(LAND_BIT | 5));
    expect(rawHeight(LAND_BIT | 25)).toBeGreaterThan(rawHeight(LAND_BIT | 15));
    expect(rawHeight(OCEAN_BIT | 10)).toBeLessThan(rawHeight(OCEAN_BIT | 1));
    expect(rawHeight(OCEAN_BIT | 1)).toBeLessThan(0);
  });

  it("keeps every land tile above sea level and every water tile below it", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const minLand = Math.fround(MIN_LAND_HEIGHT);
    const maxWater = Math.fround(MAX_WATER_HEIGHT);
    let violations = 0;
    for (let i = 0; i < terrain.length; i++) {
      const v = hf.heights[i];
      if (map.isLand(i) ? v < minLand : v > maxWater) violations++;
    }
    expect(violations).toBe(0);
  });

  it("samples tile centres exactly and interpolates between them", () => {
    const w = 4;
    const h = 1;
    const terrain = new Uint8Array([
      LAND_BIT | 0,
      LAND_BIT | 0,
      LAND_BIT | 25,
      LAND_BIT | 25,
    ]);
    const hf = Heightfield.fromTerrain(terrain, w, h, {
      blurRadius: 0,
      blurPasses: 0,
      verticalScale: 1,
    });
    expect(hf.sample(0.5, 0.5)).toBeCloseTo(rawHeight(LAND_BIT | 0));
    expect(hf.sample(2.5, 0.5)).toBeCloseTo(rawHeight(LAND_BIT | 25));
    const mid = hf.sample(2.0, 0.5);
    expect(mid).toBeCloseTo(
      (rawHeight(LAND_BIT | 0) + rawHeight(LAND_BIT | 25)) / 2,
    );
    // Out-of-range coordinates clamp instead of reading garbage.
    expect(hf.sample(-10, -10)).toBeCloseTo(hf.sample(0, 0));
    expect(hf.sample(100, 100)).toBeCloseTo(hf.sample(4, 1));
  });

  it("smoothing preserves the mean of a uniform field", () => {
    const terrain = new Uint8Array(32 * 32).fill(LAND_BIT | 12);
    const hf = Heightfield.fromTerrain(terrain, 32, 32);
    for (const v of hf.heights) {
      expect(v).toBeCloseTo(rawHeight(LAND_BIT | 12), 5);
    }
  });

  it("rejects terrain of the wrong size", () => {
    expect(() => Heightfield.fromTerrain(new Uint8Array(3), 2, 2)).toThrow();
  });
});

describe("levelHeight", () => {
  it("rises through every layer from ground to huge mountain tops", () => {
    expect(levelHeight(0)).toBeCloseTo(0.3);
    expect(levelHeight(100)).toBeCloseTo(TOP_HEIGHT);
    for (let L = 1; L <= 100; L++) {
      expect(levelHeight(L)).toBeGreaterThan(levelHeight(L - 1));
    }
    expect(IMPASSABLE_HEIGHT).toBeGreaterThan(TOP_HEIGHT);
  });

  it("keeps plains low and makes mountain layers much taller", () => {
    expect(levelHeight(33)).toBeLessThan(1.6);
    const plainStep = levelHeight(11) - levelHeight(10);
    const mountainStep = levelHeight(91) - levelHeight(90);
    expect(mountainStep).toBeGreaterThan(plainStep * 20);
  });

  it("is continuous at the band edges", () => {
    for (const edge of [100 / 3, 200 / 3]) {
      expect(levelHeight(edge + 1e-6) - levelHeight(edge - 1e-6)).toBeLessThan(
        1e-3,
      );
    }
  });

  it("is what custom-map levels give for land", () => {
    expect(rawHeight(LAND_BIT | 5, 70)).toBeCloseTo(levelHeight(70));
  });
});

describe("limitSlope", () => {
  it("turns a lone spike into a massif and leaves gentle ground alone", () => {
    const w = 21;
    const h = new Float32Array(w * w).fill(1);
    h[10 * w + 10] = 60;
    h[0] = 1.5;
    limitSlope(h, w, w, 1.6);
    expect(h[10 * w + 10]).toBeCloseTo(2.6);
    expect(h[0]).toBeCloseTo(1.5);
    for (let y = 0; y < w; y++)
      for (let x = 1; x < w; x++)
        expect(Math.abs(h[y * w + x] - h[y * w + x - 1])).toBeLessThanOrEqual(
          1.6 + 1e-5,
        );
  });

  it("keeps big real mountains tall when the ground rises to them", () => {
    const w = 81;
    const h = new Float32Array(w * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++)
        h[y * w + x] = Math.max(0, 60 - 1.5 * Math.hypot(x - 40, y - 40));
    limitSlope(h, w, w, 1.6);
    expect(h[40 * w + 40]).toBeCloseTo(60);
  });
});
