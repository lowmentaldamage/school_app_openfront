import {
  buildMap,
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";
import {
  detectImageMode,
  imageToMap,
  importSize,
  MapDocument,
  randomIslands,
} from "../../src/client/mapeditor/EditorCore";

describe("map editor document", () => {
  test("painting land, undo and redo", () => {
    const doc = MapDocument.blank(128, 128);
    doc.beginStroke();
    doc.paintLine(20, 20, 60, 20, 4, "plains");
    doc.endStroke();
    expect(doc.isLand(40, 20)).toBe(true);
    expect(doc.isLand(40, 30)).toBe(false);
    const land = doc.landTiles();
    expect(land).toBeGreaterThan(300);

    doc.beginStroke();
    doc.paint(40, 20, 3, "water");
    doc.endStroke();
    expect(doc.isLand(40, 20)).toBe(false);

    expect(doc.undo()).toBe(true);
    expect(doc.isLand(40, 20)).toBe(true);
    expect(doc.landTiles()).toBe(land);
    expect(doc.undo()).toBe(true);
    expect(doc.landTiles()).toBe(0);
    expect(doc.undo()).toBe(false);
    expect(doc.redo()).toBe(true);
    expect(doc.landTiles()).toBe(land);
  });

  test("mountain brush gives mountain elevations; raise/lower step", () => {
    const doc = MapDocument.blank(64, 64);
    doc.paint(32, 32, 5, "mountain");
    const i = 32 * 64 + 32;
    expect(doc.map.elevation[i]).toBeGreaterThanOrEqual(21);
    doc.paint(10, 10, 2, "plains");
    const j = 10 * 64 + 10;
    const before = doc.map.elevation[j];
    doc.paint(10, 10, 2, "raise");
    expect(doc.map.elevation[j]).toBeGreaterThan(before);
    for (let k = 0; k < 15; k++) doc.paint(10, 10, 2, "lower");
    expect(doc.map.kind[j]).toBe(TERRAIN_WATER);
  });

  test("nations only on land, removed when their land is flooded, undoable", () => {
    const doc = MapDocument.blank(64, 64);
    doc.paint(20, 20, 6, "plains");
    expect(doc.addNation(3, 3, "Sea", "")).toBe(false);
    doc.beginStroke();
    expect(doc.addNation(20, 20, "Home", "fr")).toBe(true);
    doc.endStroke();
    expect(doc.nationAt(21, 21, 3)).toBe(0);
    doc.beginStroke();
    doc.paint(20, 20, 3, "water");
    doc.endStroke();
    expect(doc.nations).toHaveLength(0);
    doc.undo();
    expect(doc.nations).toEqual([{ name: "Home", flag: "fr", x: 20, y: 20 }]);
  });

  test("random islands: deterministic, about the asked land share, buildable", () => {
    const a = randomIslands({ width: 200, height: 160, seed: 42, land: 0.4 });
    const b = randomIslands({ width: 200, height: 160, seed: 42, land: 0.4 });
    expect(a.kind).toEqual(b.kind);
    let land = 0;
    for (const k of a.kind) if (k === TERRAIN_LAND) land++;
    expect(land / a.kind.length).toBeGreaterThan(0.3);
    expect(land / a.kind.length).toBeLessThan(0.5);
    const built = buildMap(a);
    expect(built.numLandTiles).toBe(land);
    const c = randomIslands({ width: 200, height: 160, seed: 43 });
    expect(c.kind).not.toEqual(a.kind);
  });

  test("dirty area covers painted tiles", () => {
    const doc = MapDocument.blank(64, 64);
    doc.takeDirty();
    doc.paint(30, 40, 2, "plains");
    const d = doc.takeDirty()!;
    expect(d.x0).toBeLessThanOrEqual(28);
    expect(d.x1).toBeGreaterThanOrEqual(32);
    expect(doc.takeDirty()).toBeNull();
  });
});

describe("image import", () => {
  const img = (
    w: number,
    h: number,
    px: (x: number, y: number) => number[],
  ) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
    return { width: w, height: h, data };
  };

  test("a map picture: blue sea, green plains, white peaks", () => {
    const m = imageToMap(
      img(64, 64, (x) =>
        x < 20
          ? [30, 90, 200, 255]
          : x < 40
            ? [60, 160, 60, 255]
            : [240, 240, 240, 255],
      ),
    );
    expect(detectImageMode(img(4, 4, () => [30, 90, 200, 255]))).toBe(
      "picture",
    );
    expect(m.kind[10]).toBe(TERRAIN_WATER);
    expect(m.kind[30]).toBe(TERRAIN_LAND);
    expect(m.elevation[30]).toBeLessThan(10);
    expect(m.elevation[50]).toBeGreaterThanOrEqual(20);
  });

  test("a greyscale heightmap with a sea level", () => {
    const hm = img(64, 64, (x) => {
      const v = x * 4;
      return [v, v, v, 255];
    });
    expect(detectImageMode(hm)).toBe("heightmap");
    const m = imageToMap(hm, { seaLevel: 100 });
    expect(m.kind[10]).toBe(TERRAIN_WATER); // 40
    expect(m.kind[30]).toBe(TERRAIN_LAND); // 120
    expect(m.elevation[63]).toBeGreaterThan(m.elevation[30]);
  });

  test("the map generator's own format is read exactly", () => {
    const g = img(64, 64, (x) =>
      x < 16 ? [0, 0, 106, 255] : x < 32 ? [0, 0, 0, 0] : [10, 10, 180, 255],
    );
    expect(detectImageMode(g)).toBe("game");
    const m = imageToMap(g);
    expect(m.kind[5]).toBe(TERRAIN_WATER);
    expect(m.kind[20]).toBe(TERRAIN_WATER);
    expect(m.kind[40]).toBe(TERRAIN_LAND);
    expect(m.elevation[40]).toBe(20);
  });

  test("import size keeps the aspect, multiples of 4", () => {
    expect(importSize(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
    // Small pictures are scaled up to the chosen size.
    expect(importSize(400, 200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(importSize(301, 203, 300)).toEqual({ width: 300, height: 200 });
  });
});
