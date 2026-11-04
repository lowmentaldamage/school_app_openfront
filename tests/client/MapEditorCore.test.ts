import {
  buildMap,
  TERRAIN_LAND,
  TERRAIN_WATER,
} from "@laukolaroser/shared/maps/MapBuilder";
import {
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
