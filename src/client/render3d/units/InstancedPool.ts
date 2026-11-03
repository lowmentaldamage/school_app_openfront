/**
 * InstancedPool — one growable InstancedMesh per model kind.
 *
 * Capacity doubles when exceeded (the mesh is rebuilt, which is rare and
 * cheap); `count` is set to the number of instances written each update,
 * so unused slots cost nothing. Frustum culling is disabled at the mesh
 * level because instances spread across the whole map; the vertex cost of
 * off-screen low-poly instances is negligible next to one draw call each.
 */

import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
  type Matrix4,
  type Object3D,
} from "three";

export class InstancedPool {
  mesh: InstancedMesh;
  private n = 0;

  constructor(
    private readonly geometry: BufferGeometry,
    private readonly material: Material,
    private readonly parent: Object3D,
    private capacity = 16,
    private readonly castShadow = true,
  ) {
    this.mesh = this.create(capacity);
  }

  /** Start writing a new batch of instances. */
  begin(): void {
    this.n = 0;
  }

  /** Append one instance; returns its index. */
  push(matrix: Matrix4, color: Color): number {
    if (this.n >= this.capacity) this.grow();
    const i = this.n++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    return i;
  }

  setMatrix(i: number, matrix: Matrix4): void {
    this.mesh.setMatrixAt(i, matrix);
  }

  /** Finish the batch: upload what was written. */
  end(colorsChanged: boolean): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorsChanged && this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, this.n * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Re-upload matrices only (per-frame animation of an existing batch). */
  touchMatrices(): void {
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get size(): number {
    return this.n;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }

  private create(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    return mesh;
  }

  private grow(): void {
    const old = this.mesh;
    const cap = this.capacity * 2;
    const mesh = this.create(cap);
    (mesh.instanceMatrix.array as Float32Array).set(
      old.instanceMatrix.array as Float32Array,
    );
    if (old.instanceColor && mesh.instanceColor) {
      (mesh.instanceColor.array as Float32Array).set(
        old.instanceColor.array as Float32Array,
      );
    }
    this.parent.remove(old);
    old.dispose();
    this.mesh = mesh;
    this.capacity = cap;
  }
}
