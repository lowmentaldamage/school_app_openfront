import {
  buildMap,
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";
import {
  autoNationSpots,
  autoRelief,
  detectImageMode,
  isFlat,
  imageToMap,
  importSize,
  MapDocument,
  mirrorPoints,
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
    expect(doc.map.elevation[i]).toBeGreaterThanOrEqual(70);
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
    expect(m.elevation[30]).toBeLessThan(33);
    expect(m.elevation[50]).toBeGreaterThanOrEqual(66);
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

  test("a dark heightmap still reaches the mountain tops (100)", () => {
    // Values 0-63 only (a dark DEM export).
    const hm = img(64, 64, (x) => [x, x, x, 255]);
    const m = imageToMap(hm, { mode: "heightmap", seaLevel: 3 });
    expect(m.kind[1]).toBe(TERRAIN_WATER);
    expect(m.elevation[3]).toBe(0); // ground right at the sea level
    expect(m.elevation[63]).toBe(100);
    expect(m.elevation[33]).toBeGreaterThan(40);
    expect(m.elevation[33]).toBeLessThan(60);
  });

  test("heightmap specks don't become one-tile lakes or peaks", () => {
    const hm = img(64, 64, (x, y) =>
      (x * 7 + y * 13) % 29 === 0
        ? [255, 255, 255, 255]
        : (x * 3 + y * 5) % 31 === 0
          ? [0, 0, 0, 255]
          : [150, 150, 150, 255],
    );
    const m = imageToMap(hm, { mode: "heightmap", seaLevel: 60 });
    let water = 0;
    const elev = new Set<number>();
    for (let y = 1; y < 63; y++)
      for (let x = 1; x < 63; x++) {
        if (m.kind[y * 64 + x] === TERRAIN_WATER) water++;
        else elev.add(m.elevation[y * 64 + x]);
      }
    expect(water).toBe(0);
    expect(elev.size).toBe(1);
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
    expect(m.elevation[40]).toBe(67);
  });

  test("import size keeps the aspect, multiples of 4", () => {
    expect(importSize(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
    // Small pictures are scaled up to the chosen size.
    expect(importSize(400, 200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(importSize(301, 203, 300)).toEqual({ width: 300, height: 200 });
  });
});

describe("automatic terrain and nations", () => {
  const continent = () => {
    const doc = MapDocument.blank(256, 192);
    doc.paint(128, 96, 70, "plains");
    for (let i = 0; i < doc.map.elevation.length; i++) {
      if (doc.map.kind[i] === TERRAIN_LAND) doc.map.elevation[i] = 2;
    }
    return doc;
  };

  test("auto relief: low coasts, mountains inland, deterministic, undoable", () => {
    const doc = continent();
    expect(isFlat(doc.map)).toBe(true);
    const relief = autoRelief(doc.map, 5);
    expect(autoRelief(doc.map, 5)).toEqual(relief);
    const at = (x: number, y: number) => relief[y * 256 + x];
    expect(at(128 - 69, 96)).toBeLessThan(27); // coast
    let maxInland = 0;
    for (let y = 80; y < 112; y++)
      for (let x = 112; x < 144; x++) maxInland = Math.max(maxInland, at(x, y));
    expect(maxInland).toBeGreaterThan(at(128 - 69, 96));
    let high = 0;
    for (let i = 0; i < relief.length; i++) if (relief[i] >= 66) high++;
    expect(high).toBeGreaterThan(0);
    expect(relief[0]).toBe(0); // water untouched
    doc.setElevation(relief);
    expect(isFlat(doc.map)).toBe(false);
    doc.undo();
    expect(isFlat(doc.map)).toBe(true);
  });

  test("auto nations: on land, spread out, avoid tiny islands", () => {
    const doc = continent();
    doc.paint(10, 10, 1, "plains"); // tiny island
    const spots = autoNationSpots(doc.map, 8, 3);
    expect(spots).toHaveLength(8);
    for (const p of spots) {
      expect(doc.isLand(p.x, p.y)).toBe(true);
      expect(Math.hypot(p.x - 10, p.y - 10)).toBeGreaterThan(5);
    }
    let minPair = Infinity;
    for (let a = 0; a < spots.length; a++)
      for (let b = a + 1; b < spots.length; b++)
        minPair = Math.min(
          minPair,
          Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y),
        );
    expect(minPair).toBeGreaterThan(20);
    expect(autoNationSpots(doc.map, 8, 3)).toEqual(spots);
    // A map that is all land: nobody spawns on the border.
    const land = MapDocument.blank(200, 160);
    land.paint(100, 80, 200, "plains");
    for (const p of autoNationSpots(land.map, 10, 1)) {
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThan(192);
      expect(p.y).toBeLessThan(152);
    }
  });
});

describe("editor tools: fill, pick, smooth, level, mirror, square", () => {
  it("fill pours terrain over the connected area only", () => {
    const doc = MapDocument.blank(20, 10);
    // Water map with two separate land blocks.
    doc.beginStroke();
    doc.paint(4, 5, 2, "plains", { shape: "square" });
    doc.paint(15, 5, 2, "plains", { shape: "square" });
    doc.endStroke();
    doc.beginStroke();
    const n = doc.fill(4, 5, "mountain");
    doc.endStroke();
    expect(n).toBe(25);
    expect(doc.pick(4, 5)!.level).toBeGreaterThanOrEqual(70);
    expect(doc.pick(15, 5)!.level).toBeLessThan(33);
    // One undo step.
    doc.undo();
    expect(doc.pick(4, 5)!.level).toBeLessThan(33);
  });

  it("level paints an exact height and pick reads it back", () => {
    const doc = MapDocument.blank(10, 10);
    doc.paint(5, 5, 1, "level", { level: 47 });
    expect(doc.pick(5, 5)).toEqual({ land: true, level: 47 });
    expect(doc.pick(0, 0)!.land).toBe(false);
    expect(doc.pick(-1, 0)).toBeNull();
  });

  it("smooth evens out a spike without moving the coast", () => {
    const doc = MapDocument.blank(10, 10);
    doc.paint(5, 5, 3, "level", { level: 20, shape: "square" });
    doc.paint(5, 5, 0.5, "level", { level: 90 });
    const before = doc.landTiles();
    doc.paint(5, 5, 1, "smooth");
    expect(doc.pick(5, 5)!.level).toBeLessThan(90);
    expect(doc.landTiles()).toBe(before);
  });

  it("square brushes cover the corners a round one misses", () => {
    const round = MapDocument.blank(10, 10);
    round.paint(5, 5, 2, "plains");
    const square = MapDocument.blank(10, 10);
    square.paint(5, 5, 2, "plains", { shape: "square" });
    expect(square.landTiles()).toBe(25);
    expect(round.landTiles()).toBeLessThan(25);
  });

  it("mirror points cover every symmetry", () => {
    expect(mirrorPoints(1, 2, 10, 8, "none")).toEqual([[1, 2]]);
    expect(mirrorPoints(1, 2, 10, 8, "x")).toEqual([
      [1, 2],
      [8, 2],
    ]);
    expect(mirrorPoints(1, 2, 10, 8, "y")).toEqual([
      [1, 2],
      [1, 5],
    ]);
    expect(mirrorPoints(1, 2, 10, 8, "xy")).toHaveLength(4);
    expect(mirrorPoints(1, 2, 10, 8, "rot")).toEqual([
      [1, 2],
      [8, 5],
    ]);
  });
});
