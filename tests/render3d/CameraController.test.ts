import { describe, expect, it } from "vitest";
import { CameraController } from "../../src/client/render3d/camera/CameraController";
import { Heightfield } from "../../src/client/render3d/terrain/Heightfield";
import { loadTestTerrain } from "./util";

async function makeController() {
  const { map, terrain } = await loadTestTerrain("world");
  const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
  return { cc: new CameraController(hf), hf, map };
}

describe("CameraController", () => {
  it("maps the viewport centre to the 2D camera centre", async () => {
    const { cc, map } = await makeController();
    // Centre over open ocean (mid-Pacific) so the surface is sea level.
    expect(map.isOcean(map.ref(100, 500))).toBe(true);
    cc.sync({
      centerX: 100,
      centerY: 500,
      scale: 4,
      viewWidth: 1280,
      viewHeight: 720,
    });
    const t = cc.screenToTile(640, 360);
    expect(t).not.toBeNull();
    expect(t!.x).toBeCloseTo(100, 1);
    expect(t!.y).toBeCloseTo(500, 1);
  });

  it("round-trips tile → screen → tile, including on land", async () => {
    const { cc } = await makeController();
    cc.sync({
      centerX: 1000,
      centerY: 300,
      scale: 12,
      viewWidth: 1280,
      viewHeight: 720,
    });
    for (const [x, y] of [
      [990, 295],
      [1010, 305],
      [1000, 300],
      [985, 310],
    ]) {
      const s = cc.tileToScreen(x, y);
      const back = cc.screenToTile(s.x, s.y);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(x, 1);
      expect(back!.y).toBeCloseTo(y, 1);
    }
  });

  it("shows about as many tiles vertically as the 2D view at the same zoom", async () => {
    const { cc } = await makeController();
    const scale = 5;
    const viewHeight = 800;
    cc.sync({ centerX: 700, centerY: 600, scale, viewWidth: 1200, viewHeight });
    // Vertical span through the centre column, measured on the ground, is
    // stretched by the tilt; across the centre row it should match closely.
    const left = cc.screenToTile(0, viewHeight / 2)!;
    const right = cc.screenToTile(1200, viewHeight / 2)!;
    expect(right.x - left.x).toBeCloseTo(1200 / scale, -1);
  });

  it("zooming in shrinks the visible area", async () => {
    const { cc } = await makeController();
    const area = () => {
      const b = cc.visibleTileBounds();
      return (b.maxX - b.minX) * (b.maxY - b.minY);
    };
    cc.sync({
      centerX: 1000,
      centerY: 500,
      scale: 1,
      viewWidth: 1000,
      viewHeight: 600,
    });
    const far = area();
    cc.sync({
      centerX: 1000,
      centerY: 500,
      scale: 8,
      viewWidth: 1000,
      viewHeight: 600,
    });
    expect(area()).toBeLessThan(far / 30);
  });
});

describe("CameraController orbit", () => {
  it("drag deltas follow the camera's rotation", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const cc = new CameraController(hf);
    // North-up: dragging right moves along +x.
    let d = cc.screenDeltaToTiles(10, 0, 1);
    expect(d.x).toBeCloseTo(10);
    expect(d.y).toBeCloseTo(0);
    // Rotated 90°: screen-right now points along -y (north).
    cc.rotateBy(90);
    cc.step(1e6);
    d = cc.screenDeltaToTiles(10, 0, 1);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(-10);
  });

  it("picking stays exact when rotated and tilted", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const cc = new CameraController(hf);
    cc.rotateBy(135);
    cc.tiltBy(-20);
    cc.step(1e6);
    cc.sync({
      centerX: 1000,
      centerY: 300,
      scale: 10,
      viewWidth: 1280,
      viewHeight: 720,
    });
    for (const [x, y] of [
      [995, 296],
      [1004, 307],
    ]) {
      const s = cc.tileToScreen(x, y);
      const back = cc.screenToTile(s.x, s.y)!;
      expect(back.x).toBeCloseTo(x, 1);
      expect(back.y).toBeCloseTo(y, 1);
    }
  });

  it("clamps tilt and resets to north-up", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const cc = new CameraController(hf);
    cc.tiltBy(500);
    cc.step(1e6);
    expect(cc.pitchDeg).toBeCloseTo(89);
    cc.rotateBy(370);
    cc.step(1e6);
    cc.resetView();
    cc.step(1e6);
    expect(cc.yawDeg % 360).toBeCloseTo(0);
    expect(cc.pitchDeg).toBeCloseTo(56);
  });

  it("clicks land on the exact tile on steep mountains, at any rotation", async () => {
    const { cc, hf } = await makeController();
    // Find the highest peak and test tiles around it.
    let px = 0;
    let py = 0;
    let best = -1;
    for (let y = 50; y < hf.height - 50; y += 2)
      for (let x = 50; x < hf.width - 50; x += 2) {
        const h = hf.sample(x + 0.5, y + 0.5);
        if (h > best) {
          best = h;
          px = x;
          py = y;
        }
      }
    expect(best).toBeGreaterThan(15);
    for (const yaw of [0, 90, 200]) {
      cc.rotateBy(yaw);
      for (let i = 0; i < 40; i++) cc.step(100);
      cc.sync({
        centerX: px,
        centerY: py,
        scale: 14,
        viewWidth: 1280,
        viewHeight: 720,
      });
      for (let dy = -4; dy <= 4; dy += 2)
        for (let dx = -4; dx <= 4; dx += 2) {
          const tx = px + dx + 0.5;
          const ty = py + dy + 0.5;
          const s = cc.tileToScreen(tx, ty);
          const back = cc.screenToTile(s.x, s.y)!;
          expect(Math.floor(back.x)).toBe(Math.floor(tx));
          expect(Math.floor(back.y)).toBe(Math.floor(ty));
        }
    }
  });
});
