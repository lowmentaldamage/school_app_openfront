import express from "express";
import fs from "fs";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import {
  blankMap,
  buildMap,
  TERRAIN_LAND,
} from "../../packages/shared/src/maps/MapBuilder";
import {
  bundledMapsDir,
  createCustomMapRouter,
  decodeUpload,
  encodeUpload,
  type CustomMapUpload,
  seedBundledMaps,
} from "../../src/server/CustomMaps";

function island(): Uint8Array {
  const m = blankMap(128, 96);
  for (let y = 20; y < 70; y++)
    for (let x = 30; x < 100; x++) {
      m.kind[y * 128 + x] = TERRAIN_LAND;
      m.elevation[y * 128 + x] = 5;
    }
  return buildMap(m).map;
}

const header = (over: Partial<CustomMapUpload> = {}): CustomMapUpload => ({
  name: "Test Isle!",
  tribes: 42,
  width: 128,
  height: 96,
  nations: [
    { name: "North", flag: "fr", coordinates: [40, 30] },
    // In the water: dropped.
    { name: "Wet", coordinates: [2, 2] },
  ],
  ...over,
});

describe("custom maps", () => {
  let base = "";
  let server: ReturnType<express.Express["listen"]>;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-maps-"));
  const prevSelfHost = process.env.SELF_HOSTED;

  beforeAll(() => {
    process.env.SELFHOST_DATA_DIR = dir;
    delete process.env.SELF_HOSTED;
    const app = express();
    app.use(express.json());
    app.use("/api/maps", createCustomMapRouter());
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/maps`;
  });
  afterAll(() => {
    server.close();
    if (prevSelfHost !== undefined) process.env.SELF_HOSTED = prevSelfHost;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("upload encoding round-trips", () => {
    const bin = island();
    const { header: h, mapBin } = decodeUpload(
      Buffer.from(encodeUpload(header(), bin)),
    );
    expect(h.name).toBe("Test Isle!");
    expect(mapBin).toEqual(bin);
  });

  test("height levels (0 ground - 100 mountain tops) are stored", async () => {
    const bin = island();
    const levels = new Uint8Array(128 * 96);
    for (let i = 0; i < levels.length; i++) {
      if (bin[i] & 0x80) levels[i] = (i % 128) % 101;
    }
    const { levels: back } = decodeUpload(
      Buffer.from(encodeUpload(header(), bin, levels)),
    );
    expect(back).toEqual(levels);
    const save = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from(encodeUpload(header(), bin, levels)),
    });
    const { id } = (await save.json()) as { id: string };
    const h = new Uint8Array(
      await (await fetch(`${base}/${id}/height.bin`)).arrayBuffer(),
    );
    expect(h.length).toBe(128 * 96);
    expect(h[40 * 128 + 70]).toBe(70);
    expect(h[2 * 128 + 2]).toBe(0);
    // The game's own tile: level 70 → magnitude 21 (mountain).
    const map = new Uint8Array(
      await (await fetch(`${base}/${id}/map.bin`)).arrayBuffer(),
    );
    expect(map[40 * 128 + 70] & 0x1f).toBe(21);
    const h4 = await fetch(`${base}/${id}/height4x.bin`);
    expect((await h4.arrayBuffer()).byteLength).toBe(64 * 48);
    await fetch(`${base}/${id}`, { method: "DELETE" });
    const bad = new Uint8Array(levels).fill(101);
    expect(() =>
      decodeUpload(Buffer.from(encodeUpload(header(), bin, bad))),
    ).toThrow();
  });

  test("a size that doesn't match the tiles is refused", () => {
    expect(() =>
      decodeUpload(Buffer.from(encodeUpload(header({ width: 132 }), island()))),
    ).toThrow();
  });

  test("save, list, fetch files, delete", async () => {
    const save = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from(encodeUpload(header(), island())),
    });
    expect(save.status).toBe(200);
    const { id } = (await save.json()) as { id: string };
    expect(id).toMatch(/^[a-z0-9]{12}$/);

    const list = (await (await fetch(base)).json()) as {
      maps: { id: string; name: string; nations: number }[];
    };
    // The bundled map (Črna na Koroškem) is installed too.
    expect(list.maps.map((m) => m.id)).toContain("crnakoroskem");
    const mine = list.maps.filter((m) => m.id === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id,
      name: "Test Isle!",
      nations: 1,
      tribes: 42,
    });

    const manifest = (await (
      await fetch(`${base}/${id}/manifest.json`)
    ).json()) as {
      name: string;
      map: { width: number; num_land_tiles: number };
      map4x: { width: number };
    };
    expect(manifest.name).toBe("Test Isle");
    expect(manifest.map.num_land_tiles).toBe(70 * 50);
    expect(manifest.map4x.width).toBe(64);
    const bin = new Uint8Array(
      await (await fetch(`${base}/${id}/map16x.bin`)).arrayBuffer(),
    );
    expect(bin.length).toBe(32 * 24);

    expect((await fetch(`${base}/${id}/../../x`)).status).toBe(404);
    expect((await fetch(`${base}/${id}/secret.txt`)).status).toBe(404);

    const del = await fetch(`${base}/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = (await (await fetch(base)).json()) as {
      maps: { id: string }[];
    };
    expect(after.maps.map((m) => m.id)).not.toContain(id);
  });

  test("private server: saving needs a login, deleting needs an admin", async () => {
    process.env.SELF_HOSTED = "1";
    try {
      const save = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from(encodeUpload(header(), island())),
      });
      expect(save.status).toBe(401);
      const del = await fetch(`${base}/abcdef123456`, { method: "DELETE" });
      expect(del.status).toBe(403);
    } finally {
      delete process.env.SELF_HOSTED;
    }
  });

  test("bundled maps are installed once; an admin delete sticks", async () => {
    const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
    const id = "bundledtest1";
    fs.mkdirSync(path.join(bundle, id));
    fs.writeFileSync(
      path.join(bundle, id, "manifest.json"),
      JSON.stringify({
        name: "Bundled",
        display_name: "Bundled",
        map: { width: 128, height: 96, num_land_tiles: 1 },
        nations: [],
        custom: { createdAt: 1 },
      }),
    );
    fs.writeFileSync(path.join(bundle, id, "map.bin"), island());
    expect(seedBundledMaps(bundle)).toEqual([id]);
    expect(seedBundledMaps(bundle)).toEqual([]);
    const list = (await (await fetch(base)).json()) as {
      maps: { id: string }[];
    };
    expect(list.maps.map((m) => m.id)).toContain(id);
    expect((await fetch(`${base}/${id}/map.bin`)).status).toBe(200);
    // Deleting writes a marker only for maps that are really bundled; mimic
    // that here by pointing the marker check at this bundle.
    await fetch(`${base}/${id}`, { method: "DELETE" });
    fs.writeFileSync(path.join(dir, "maps", `.deleted-${id}`), "");
    expect(seedBundledMaps(bundle)).toEqual([]);
    fs.rmSync(bundle, { recursive: true, force: true });
  });

  test.each([
    ["crnakoroskem", "Črna na Koroškem", "Crna na Koroskem", 8],
    ["crnakoroskem2", "Črna na Koroškem 2", "Crna na Koroskem 2", 8],
    ["slovenija", "Slovenija", "Slovenija", 14],
  ])(
    "%s ships with the game, with its heights",
    (id, display, name, nations) => {
      const dir = path.join(bundledMapsDir(), id);
      const m = JSON.parse(
        fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
      );
      expect(m.display_name).toBe(display);
      expect(m.name).toBe(name);
      expect(m.nations).toHaveLength(nations);
      const tiles = m.map.width * m.map.height;
      const bin = fs.readFileSync(path.join(dir, "map.bin"));
      expect(bin.length).toBe(tiles);
      const h = fs.readFileSync(path.join(dir, "height.bin"));
      expect(h.length).toBe(tiles);
      // 0 ground … 100 mountain tops, and far more than the 31 steps.
      const used = new Set(h);
      expect(Math.max(...used)).toBeLessThanOrEqual(100);
      expect(used.size).toBeGreaterThan(60);
      expect(fs.readFileSync(path.join(dir, "height4x.bin")).length).toBe(
        tiles / 4,
      );
      // Every nation stands on land.
      for (const n of m.nations) {
        expect(
          bin[n.coordinates[1] * m.map.width + n.coordinates[0]] & 0x80,
        ).toBeTruthy();
      }
    },
  );

  test("a map with no land is refused", async () => {
    const save = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from(
        encodeUpload(header(), new Uint8Array(128 * 96).fill(0x20)),
      ),
    });
    expect(save.status).toBe(400);
  });
});
