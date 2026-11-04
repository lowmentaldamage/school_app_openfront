import {
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";
import {
  decodeHeightFile,
  heightsToMap,
  MapFileError,
} from "../../src/client/mapeditor/MapFileFormats";

const enc = (s: string) => new TextEncoder().encode(s);

/** A ramp from -50 (west) to 950 (east). */
function ramp(
  w: number,
  h: number,
  f = (x: number) => x * (1000 / (w - 1)) - 50,
) {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(f(x));
  return out;
}

function expectRampMap(name: string, bytes: Uint8Array, metres: boolean) {
  const g = decodeHeightFile(name, bytes)!;
  expect(g).not.toBeNull();
  const m = heightsToMap(g, 64, 64, metres ? 60 : 30);
  expect(m.kind[32 * 64 + 0]).toBe(TERRAIN_WATER);
  expect(m.kind[32 * 64 + 63]).toBe(TERRAIN_LAND);
  expect(m.elevation[32 * 64 + 63]).toBeGreaterThan(m.elevation[32 * 64 + 20]);
  return g;
}

describe("map file formats", () => {
  test("ESRI ASCII grid (metres, sea level 0, no-data is water)", () => {
    const w = 16;
    const vals = ramp(w, w);
    vals[w * w - 1] = -9999;
    const src = `ncols ${w}\nnrows ${w}\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -9999\n${vals.join(" ")}`;
    const g = expectRampMap("dem.asc", enc(src), true);
    expect(g.seaLevel).toBe(0);
    const m = heightsToMap(g, 64, 64);
    expect(m.kind[64 * 64 - 1]).toBe(TERRAIN_WATER);
  });

  test("SRTM .hgt tile (big-endian int16)", () => {
    const side = 16;
    const vals = ramp(side, side);
    const b = new Uint8Array(side * side * 2);
    const dv = new DataView(b.buffer);
    vals.forEach((v, i) => dv.setInt16(i * 2, Math.round(v), false));
    expectRampMap("N45E006.hgt", b, true);
  });

  test("16-bit and 8-bit raw heightmaps", () => {
    const side = 32;
    const b16 = new Uint8Array(side * side * 2);
    const dv = new DataView(b16.buffer);
    ramp(side, side, (x) => x * 2000).forEach((v, i) =>
      dv.setUint16(i * 2, v, true),
    );
    expectRampMap("terrain.r16", b16, false);
    const b8 = Uint8Array.from(ramp(side, side, (x) => x * 8));
    expectRampMap("terrain.raw", b8, false);
  });

  test("Netpbm: text PGM, binary 16-bit PGM, binary PPM", () => {
    const w = 16;
    const vals = ramp(w, w, (x) => x * 16);
    expectRampMap(
      "h.pgm",
      enc(`P2\n# comment\n${w} ${w}\n255\n${vals.join(" ")}`),
      false,
    );
    const head = enc(`P5\n${w} ${w}\n65535\n`);
    const body = new Uint8Array(w * w * 2);
    vals.forEach((v, i) => {
      body[i * 2] = (v * 256) >> 8;
      body[i * 2 + 1] = 0;
    });
    const p5 = new Uint8Array(head.length + body.length);
    p5.set(head);
    p5.set(body, head.length);
    expectRampMap("h16.pgm", p5, false);
    const head6 = enc(`P6 ${w} ${w} 255\n`);
    const p6 = new Uint8Array(head6.length + w * w * 3);
    p6.set(head6);
    vals.forEach((v, i) =>
      p6.fill(v, head6.length + i * 3, head6.length + i * 3 + 3),
    );
    expectRampMap("h.ppm", p6, false);
  });

  test("uncompressed TIFF: 16-bit grey and 32-bit float DEM", () => {
    const tiff = (
      w: number,
      h: number,
      bits: number,
      format: number,
      put: (dv: DataView, o: number, v: number) => void,
      vals: number[],
    ) => {
      const entries = [
        [256, 3, 1, w],
        [257, 3, 1, h],
        [258, 3, 1, bits],
        [259, 3, 1, 1],
        [262, 3, 1, 1],
        [273, 4, 1, 0], // patched
        [277, 3, 1, 1],
        [278, 3, 1, h],
        [279, 4, 1, w * h * (bits / 8)],
        [339, 3, 1, format],
      ];
      const ifdSize = 2 + entries.length * 12 + 4;
      const dataAt = 8 + ifdSize;
      const buf = new Uint8Array(dataAt + w * h * (bits / 8));
      const dv = new DataView(buf.buffer);
      buf[0] = 0x49;
      buf[1] = 0x49;
      dv.setUint16(2, 42, true);
      dv.setUint32(4, 8, true);
      dv.setUint16(8, entries.length, true);
      entries.forEach(([tag, type, count, value], k) => {
        const e = 10 + k * 12;
        dv.setUint16(e, tag, true);
        dv.setUint16(e + 2, type, true);
        dv.setUint32(e + 4, count, true);
        const val = tag === 273 ? dataAt : value;
        if (type === 3) dv.setUint16(e + 8, val, true);
        else dv.setUint32(e + 8, val, true);
      });
      vals.forEach((v, i) => put(dv, dataAt + i * (bits / 8), v));
      return buf;
    };
    const w = 16;
    expectRampMap(
      "grey.tif",
      tiff(
        w,
        w,
        16,
        1,
        (dv, o, v) => dv.setUint16(o, v, true),
        ramp(w, w, (x) => x * 4000),
      ),
      false,
    );
    const g = expectRampMap(
      "dem.tiff",
      tiff(w, w, 32, 3, (dv, o, v) => dv.setFloat32(o, v, true), ramp(w, w)),
      true,
    );
    expect(g.seaLevel).toBe(0);
  });

  test("CSV grids; images are left to the browser; bad files explain", () => {
    const rows = Array.from({ length: 8 }, () => ramp(8, 1).join(",")).join(
      "\n",
    );
    expectRampMap("grid.csv", enc(rows), true);
    expect(decodeHeightFile("map.png", new Uint8Array(4))).toBeNull();
    expect(() => decodeHeightFile("x.raw", new Uint8Array(7))).toThrow(
      MapFileError,
    );
    expect(() => decodeHeightFile("x.tif", enc("nope"))).toThrow(MapFileError);
  });
});
