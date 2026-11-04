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
  createCustomMapRouter,
  decodeUpload,
  encodeUpload,
  type CustomMapUpload,
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
    expect(list.maps).toHaveLength(1);
    expect(list.maps[0]).toMatchObject({ id, name: "Test Isle!", nations: 1 });

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
    const after = (await (await fetch(base)).json()) as { maps: unknown[] };
    expect(after.maps).toHaveLength(0);
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
