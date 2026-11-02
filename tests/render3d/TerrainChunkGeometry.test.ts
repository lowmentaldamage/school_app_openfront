import { describe, expect, it } from "vitest";
import { Heightfield } from "../../src/client/render3d/terrain/Heightfield";
import {
  axisSamples,
  buildChunkGeometry,
} from "../../src/client/render3d/terrain/TerrainChunkGeometry";
import { baseStrideFor } from "../../src/client/render3d/terrain/TerrainRenderer";
import { loadTestTerrain } from "./util";

describe("axisSamples", () => {
  it("always includes both ends", () => {
    expect(axisSamples(0, 8, 4)).toEqual([0, 4, 8]);
    expect(axisSamples(0, 10, 4)).toEqual([0, 4, 8, 10]);
    expect(axisSamples(128, 130, 4)).toEqual([128, 130]);
  });
});

describe("buildChunkGeometry", () => {
  it("produces a surface grid plus a skirt ring with valid indices", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const g = buildChunkGeometry(hf, { x0: 0, y0: 0, x1: 64, y1: 64 }, 4, 2);
    // 17 × 17 surface vertices, 64 perimeter vertices.
    expect(g.surfaceVertexCount).toBe(17 * 17);
    expect(g.positions.length / 3).toBe(17 * 17 + 64);
    const vertexCount = g.positions.length / 3;
    for (const idx of g.indices) expect(idx).toBeLessThan(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const len = Math.hypot(
        g.normals[i * 3],
        g.normals[i * 3 + 1],
        g.normals[i * 3 + 2],
      );
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it("surface triangles face up (+y)", async () => {
    const { map, terrain } = await loadTestTerrain("plains");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const g = buildChunkGeometry(hf, { x0: 0, y0: 0, x1: 32, y1: 32 }, 2, 2);
    const surfaceTris = (16 * 16 * 6) / 3;
    const p = g.positions;
    for (let t = 0; t < surfaceTris; t++) {
      const [a, b, c] = [
        g.indices[t * 3],
        g.indices[t * 3 + 1],
        g.indices[t * 3 + 2],
      ];
      const e1 = [
        p[b * 3] - p[a * 3],
        p[b * 3 + 1] - p[a * 3 + 1],
        p[b * 3 + 2] - p[a * 3 + 2],
      ];
      const e2 = [
        p[c * 3] - p[a * 3],
        p[c * 3 + 1] - p[a * 3 + 1],
        p[c * 3 + 2] - p[a * 3 + 2],
      ];
      // y component of e1 × e2
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      expect(ny).toBeGreaterThan(0);
    }
  });

  it("neighbouring chunks agree on shared edge heights and normals", async () => {
    const { map, terrain } = await loadTestTerrain("world");
    const hf = Heightfield.fromTerrain(terrain, map.width(), map.height());
    const left = buildChunkGeometry(
      hf,
      { x0: 0, y0: 0, x1: 128, y1: 128 },
      2,
      2,
    );
    const right = buildChunkGeometry(
      hf,
      { x0: 128, y0: 0, x1: 256, y1: 128 },
      2,
      2,
    );
    const n = 65;
    for (let j = 0; j < n; j++) {
      const l = (j * n + (n - 1)) * 3;
      const r = j * n * 3;
      expect(left.positions[l]).toBe(right.positions[r]);
      expect(left.positions[l + 1]).toBe(right.positions[r + 1]);
      expect(left.positions[l + 2]).toBe(right.positions[r + 2]);
      expect(left.normals[l + 1]).toBe(right.normals[r + 1]);
    }
  });
});

describe("baseStrideFor", () => {
  it("keeps LOD 0 under ~1.5M vertices", () => {
    expect(baseStrideFor(1000, 500)).toBe(1);
    expect(baseStrideFor(2000, 1000)).toBe(2);
    const s = baseStrideFor(4744, 2628);
    expect((4744 / s) * (2628 / s)).toBeLessThanOrEqual(1_500_000);
  });
});
