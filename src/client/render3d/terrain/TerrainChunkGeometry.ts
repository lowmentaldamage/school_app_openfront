/**
 * Builds the vertex data for one terrain chunk at a given sampling stride.
 *
 * Pure (no three.js) so the mesh topology can be unit tested. Positions use
 * world units: x → tile x, z → tile y, y → height. Normals come from
 * central differences on the shared Heightfield, so adjacent chunks agree
 * exactly along their seams. A downward "skirt" around the chunk hides the
 * T-junction cracks that appear where neighbouring chunks use different LOD
 * strides.
 */

import type { Heightfield } from "./Heightfield";

export interface ChunkRegion {
  x0: number;
  y0: number;
  /** Exclusive end, clamped to the map. */
  x1: number;
  y1: number;
}

export interface ChunkGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Vertices in the surface grid (excludes skirt vertices). */
  surfaceVertexCount: number;
}

/** Sample coordinates along one axis: start, start+s, …, always ending at end. */
export function axisSamples(
  start: number,
  end: number,
  stride: number,
): number[] {
  const out: number[] = [];
  for (let v = start; v < end; v += stride) out.push(v);
  out.push(end);
  return out;
}

export function buildChunkGeometry(
  hf: Heightfield,
  region: ChunkRegion,
  stride: number,
  skirtDepth: number,
): ChunkGeometryData {
  const xs = axisSamples(region.x0, region.x1, stride);
  const ys = axisSamples(region.y0, region.y1, stride);
  const nx = xs.length;
  const ny = ys.length;
  const surface = nx * ny;
  const perimeter = 2 * (nx + ny) - 4;
  const total = surface + perimeter;

  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const d = Math.max(1, stride);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const y = ys[j];
      const k = (j * nx + i) * 3;
      positions[k] = x;
      positions[k + 1] = hf.sample(x, y);
      positions[k + 2] = y;
      const dx = hf.sample(x + d, y) - hf.sample(x - d, y);
      const dz = hf.sample(x, y + d) - hf.sample(x, y - d);
      const len = Math.hypot(dx, 2 * d, dz);
      normals[k] = -dx / len;
      normals[k + 1] = (2 * d) / len;
      normals[k + 2] = -dz / len;
    }
  }

  // Perimeter in order: top row → right column → bottom row (reversed) →
  // left column (reversed). Each skirt vertex copies its edge vertex,
  // dropped by skirtDepth.
  const ring: number[] = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
  for (let j = ny - 2; j >= 1; j--) ring.push(j * nx);

  for (let r = 0; r < ring.length; r++) {
    const src = ring[r] * 3;
    const dst = (surface + r) * 3;
    positions[dst] = positions[src];
    positions[dst + 1] = positions[src + 1] - skirtDepth;
    positions[dst + 2] = positions[src + 2];
    normals[dst] = normals[src];
    normals[dst + 1] = normals[src + 1];
    normals[dst + 2] = normals[src + 2];
  }

  const quads = (nx - 1) * (ny - 1);
  // Skirt quads are emitted with both windings so they are visible from
  // either side without making the whole material double-sided.
  const indices = new Uint32Array(quads * 6 + ring.length * 12);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const e = c + 1;
      // Counter-clockwise seen from +y (x right, z down the screen).
      indices[p++] = a;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = e;
    }
  }
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r];
    const b = ring[(r + 1) % ring.length];
    const sa = surface + r;
    const sb = surface + ((r + 1) % ring.length);
    indices[p++] = a;
    indices[p++] = sa;
    indices[p++] = b;
    indices[p++] = b;
    indices[p++] = sa;
    indices[p++] = sb;
    indices[p++] = a;
    indices[p++] = b;
    indices[p++] = sa;
    indices[p++] = b;
    indices[p++] = sb;
    indices[p++] = sa;
  }

  return { positions, normals, indices, surfaceVertexCount: surface };
}
