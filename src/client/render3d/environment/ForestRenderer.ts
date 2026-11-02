/**
 * ForestRenderer — dense instanced forests.
 *
 * Trees (from ForestPlacement) are bucketed into 256-tile map regions; each
 * region gets one InstancedMesh per tree kind with an exact bounding
 * sphere, so three.js frustum-culls whole regions. Trees fade out of the
 * scene when the camera is far (they would be sub-pixel noise) and grow a
 * little with distance so forests still read as forests from afar. A
 * gentle wind sway runs in the vertex shader; no per-frame CPU work.
 */

import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
} from "three";
import type { Heightfield } from "../terrain/Heightfield";
import { ModelBuilder } from "../units/ModelBuilder";
import { placeTrees, type ForestOptions } from "./ForestPlacement";

const REGION = 256;
const TRUNK = 0x5a4030;

function conifer(): BufferGeometry {
  return new ModelBuilder()
    .cylinder(0.06, 0.09, 0.4, 5, { color: TRUNK })
    .cone(0.55, 0.9, 7, { team: true, pos: [0, 0.3, 0] })
    .cone(0.42, 0.75, 7, { team: true, pos: [0, 0.75, 0] })
    .cone(0.28, 0.6, 7, { team: true, pos: [0, 1.15, 0] })
    .build();
}

function broadleaf(): BufferGeometry {
  return new ModelBuilder()
    .cylinder(0.07, 0.1, 0.55, 5, { color: TRUNK })
    .sphere(0.5, { team: true, pos: [0, 0.95, 0], scale: [1, 0.85, 1] })
    .sphere(0.36, { team: true, pos: [0.25, 0.75, 0.1] })
    .sphere(0.34, { team: true, pos: [-0.22, 0.8, -0.15] })
    .build();
}

export class ForestRenderer {
  readonly group = new Group();
  readonly treeCount: number;
  private readonly material: MeshStandardMaterial;
  private readonly uniforms = { uTreeScale: { value: 1 }, uTime: { value: 0 } };
  private readonly geometries: BufferGeometry[];
  private readonly meshes: InstancedMesh[] = [];

  constructor(
    terrain: Uint8Array,
    hf: Heightfield,
    options: ForestOptions,
    /** Hide trees beyond this camera distance. */
    private readonly maxDistance: number,
  ) {
    this.group.name = "forests";
    this.material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
    });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float teamMask;\nuniform float uTreeScale;\nuniform float uTime;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
transformed *= uTreeScale;
vec3 lkrOrigin = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
float lkrSway = sin(uTime * 1.3 + lkrOrigin.x * 0.21 + lkrOrigin.z * 0.17) * 0.035 * transformed.y;
transformed.x += lkrSway;
transformed.z += lkrSway * 0.6;`,
        )
        .replace(
          "#include <color_vertex>",
          "vColor = vec4(mix(color.rgb, instanceColor.rgb, teamMask), 1.0);",
        );
    };
    this.material.customProgramCacheKey = () => "laukolaroser-tree-v1";

    const trees = placeTrees(terrain, hf, options);
    this.treeCount = trees.length;
    this.geometries = [conifer(), broadleaf()];

    // Bucket by region and kind.
    const buckets = new Map<string, typeof trees>();
    for (const t of trees) {
      const key = `${Math.floor(t.x / REGION)},${Math.floor(t.y / REGION)},${t.conifer ? 0 : 1}`;
      let b = buckets.get(key);
      if (b === undefined) buckets.set(key, (b = []));
      b.push(t);
    }

    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const sc = new Vector3();
    const c = new Color();
    const up = new Vector3(0, 1, 0);
    for (const [key, list] of buckets) {
      const kind = Number(key.split(",")[2]);
      const mesh = new InstancedMesh(
        this.geometries[kind],
        this.material,
        list.length,
      );
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        q.setFromAxisAngle(up, t.yaw);
        p.set(t.x, t.h - 0.05, t.y);
        sc.setScalar(t.size);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
        if (t.conifer) {
          c.setRGB(
            0.12 + t.tint * 0.06,
            0.3 + t.tint * 0.08,
            0.16 + t.tint * 0.04,
            SRGBColorSpace,
          );
        } else {
          c.setRGB(
            0.2 + t.tint * 0.2,
            0.42 + t.tint * 0.1,
            0.14,
            SRGBColorSpace,
          );
        }
        mesh.setColorAt(i, c);
      }
      mesh.computeBoundingSphere();
      // Account for the zoom scale-up and wind in the culling sphere.
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 6;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Per frame. */
  update(timeSeconds: number, cameraDistance: number): void {
    const visible = cameraDistance < this.maxDistance;
    this.group.visible = visible;
    if (!visible) return;
    this.uniforms.uTime.value = timeSeconds;
    this.uniforms.uTreeScale.value = Math.max(
      1,
      Math.min(2.4, cameraDistance / 90),
    );
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
