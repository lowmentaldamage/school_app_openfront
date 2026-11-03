import { describe, expect, it } from "vitest";
import {
  Heightfield,
  MAX_WATER_HEIGHT,
  MIN_LAND_HEIGHT,
  rawHeight,
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
