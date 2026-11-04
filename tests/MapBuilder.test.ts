import {
  blankMap,
  buildMap,
  decodeMap,
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";
import fs from "fs";
import path from "path";

function load(name: string) {
  const dir = path.join(__dirname, "..", "resources", "maps", name);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  return {
    manifest,
    map: new Uint8Array(fs.readFileSync(path.join(dir, "map.bin"))),
    map4x: new Uint8Array(fs.readFileSync(path.join(dir, "map4x.bin"))),
  };
}

describe("MapBuilder", () => {
  test("decoding and rebuilding a real map reproduces its map.bin", () => {
    const { manifest, map } = load("britannia");
    const { width, height } = manifest.map;
    const rebuilt = buildMap(decodeMap(map, width, height));
    expect(rebuilt.width).toBe(width);
    expect(rebuilt.numLandTiles).toBe(manifest.map.num_land_tiles);
    let diff = 0;
    for (let i = 0; i < map.length; i++) if (rebuilt.map[i] !== map[i]) diff++;
    expect(diff / map.length).toBeLessThan(0.001);
  });

  test("downscales keep sizes and land counts close to the generator's", () => {
    const { manifest, map } = load("britannia");
    const { width, height } = manifest.map;
    const rebuilt = buildMap(decodeMap(map, width, height));
    expect(rebuilt.map4x.length).toBe((width / 2) * (height / 2));
    expect(rebuilt.map16x.length).toBe((width / 4) * (height / 4));
    const off =
      Math.abs(rebuilt.numLandTiles4x - manifest.map4x.num_land_tiles) /
      manifest.map4x.num_land_tiles;
    expect(off).toBeLessThan(0.02);
  });

  test("a painted island gets shores, ocean and depth", () => {
    const m = blankMap(128, 128);
    for (let y = 40; y < 80; y++)
      for (let x = 40; x < 80; x++) {
        m.kind[y * 128 + x] = TERRAIN_LAND;
        m.elevation[y * 128 + x] = x > 60 ? 25 : 3;
      }
    const b = buildMap(m);
    const at = (x: number, y: number) => b.map[y * 128 + x];
    expect(at(50, 50) & 0x80).toBeTruthy(); // land
    expect(at(40, 50) & 0x40).toBeTruthy(); // shore land
    expect(at(39, 50) & 0x40).toBeTruthy(); // shore water
    expect(at(5, 5) & 0x20).toBeTruthy(); // ocean
    expect(at(70, 50) & 0x1f).toBe(25); // mountain
    expect(at(5, 5) & 0x1f).toBeGreaterThan(10); // deep far from land
    expect(b.numLandTiles).toBe(1600);
    expect(m.kind[0]).toBe(TERRAIN_WATER);
  });
});
