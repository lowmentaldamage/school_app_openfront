/**
 * TerrainRenderer — chunked, LOD'd terrain meshes built from the Heightfield.
 *
 * The map is split into square chunks; each chunk is a THREE.LOD with
 * progressively coarser strides. three.js frustum-culls each chunk mesh by
 * its bounding sphere and picks the LOD level by camera distance, so only
 * nearby terrain is drawn at full density. All chunks share one material.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LOD,
  Mesh,
  type Material,
} from "three";
import type { Heightfield } from "./Heightfield";
import { buildChunkGeometry } from "./TerrainChunkGeometry";

export interface TerrainRendererOptions {
  /** Chunk edge length in tiles. */
  chunkSize: number;
  /** Stride of LOD 0, chosen from the map size (see baseStrideFor). */
  baseStride: number;
  /** Stride multipliers per LOD level. */
  lodMultipliers: readonly number[];
  /** Camera distance (in chunk sizes) at which each LOD level starts. */
  lodDistances: readonly number[];
  skirtDepth: number;
}

/** Keeps LOD 0 at roughly ≤1.5M vertices across the whole map. */
export function baseStrideFor(mapWidth: number, mapHeight: number): number {
  return Math.max(1, Math.ceil(Math.sqrt((mapWidth * mapHeight) / 1_500_000)));
}

export class TerrainRenderer {
  readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];

  constructor(
    private readonly hf: Heightfield,
    private readonly material: Material,
    private readonly options: TerrainRendererOptions,
  ) {
    this.group.name = "terrain";
    this.build();
  }

  private build(): void {
    const { chunkSize, baseStride, lodMultipliers, lodDistances, skirtDepth } =
      this.options;
    const { width, height } = this.hf;
    for (let y0 = 0; y0 < height; y0 += chunkSize) {
      for (let x0 = 0; x0 < width; x0 += chunkSize) {
        const region = {
          x0,
          y0,
          x1: Math.min(x0 + chunkSize, width),
          y1: Math.min(y0 + chunkSize, height),
        };
        const lod = new LOD();
        lod.name = `terrain-chunk-${x0}-${y0}`;
        for (let l = 0; l < lodMultipliers.length; l++) {
          const stride = Math.min(baseStride * lodMultipliers[l], chunkSize);
          const data = buildChunkGeometry(this.hf, region, stride, skirtDepth);
          const geom = new BufferGeometry();
          geom.setAttribute("position", new BufferAttribute(data.positions, 3));
          geom.setAttribute("normal", new BufferAttribute(data.normals, 3));
          geom.setIndex(new BufferAttribute(data.indices, 1));
          geom.computeBoundingSphere();
          geom.computeBoundingBox();
          this.geometries.push(geom);
          const mesh = new Mesh(geom, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          lod.addLevel(mesh, (lodDistances[l] ?? 0) * chunkSize);
        }
        // LOD measures distance from its own origin; put it at the chunk
        // centre and offset the meshes back so geometry stays in world space.
        const cx = (region.x0 + region.x1) / 2;
        const cy = (region.y0 + region.y1) / 2;
        lod.position.set(cx, 0, cy);
        for (const level of lod.levels) {
          level.object.position.set(-cx, 0, -cy);
          level.object.updateMatrix();
        }
        lod.updateMatrixWorld(true);
        lod.matrixAutoUpdate = false;
        this.group.add(lod);
      }
    }
  }

  chunkCount(): number {
    return this.group.children.length;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.group.clear();
  }
}
