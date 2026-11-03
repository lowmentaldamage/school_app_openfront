/**
 * SeaLife — ambient life on the water: small fishing boats drifting off
 * the coasts and gulls circling above them. Decoration only (not game
 * units), placed once from the heightfield with a fixed seed, animated per
 * frame, two instanced draw calls. Hidden when zoomed far out.
 */

import {
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { Heightfield } from "../terrain/Heightfield";
import { ModelBuilder } from "../units/ModelBuilder";

interface Spot {
  x: number;
  z: number;
  r: number;
  speed: number;
  phase: number;
}

/** Camera distance beyond which sea life is hidden. */
const HIDE_DISTANCE = 420;

/** Shallow water close to land, chosen with a fixed seed. */
export function seaLifeSpots(hf: Heightfield, count: number, seed = 7): Spot[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: Spot[] = [];
  for (let tries = 0; tries < count * 60 && out.length < count; tries++) {
    const x = rnd() * hf.width;
    const z = rnd() * hf.height;
    const h = hf.sample(x, z);
    if (h > -0.15 || h < -2.2) continue;
    // Land within a few tiles (coastal waters).
    let coast = false;
    for (let a = 0; a < 6 && !coast; a++) {
      const ang = (a / 6) * Math.PI * 2;
      if (hf.sample(x + Math.cos(ang) * 4, z + Math.sin(ang) * 4) > 0) {
        coast = true;
      }
    }
    if (!coast) continue;
    out.push({
      x,
      z,
      r: 0.8 + rnd() * 2.2,
      speed: (0.08 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1),
      phase: rnd() * Math.PI * 2,
    });
  }
  return out;
}

export class SeaLife {
  readonly group = new Group();
  private readonly boats: InstancedMesh;
  private readonly gulls: InstancedMesh;
  private readonly boatSpots: Spot[];
  private readonly gullSpots: Spot[];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(hf: Heightfield, count: number) {
    const material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.7,
    });
    const boatGeo = new ModelBuilder()
      .hull(0.9, 0.32, 0.12, { color: 0x8a5a3a })
      .box(0.26, 0.16, 0.2, { color: 0xe8e2d0, pos: [-0.12, 0.08, 0] })
      .box(0.02, 0.5, 0.02, { color: 0x3c3226, pos: [0.15, 0.08, 0] })
      .build();
    const gullGeo = new ModelBuilder()
      .box(0.32, 0.02, 0.07, {
        color: 0xf2f2f0,
        pos: [0.0, 0, 0.14],
        rot: [0.35, 0.5, 0],
      })
      .box(0.32, 0.02, 0.07, {
        color: 0xf2f2f0,
        pos: [0.0, 0, -0.14],
        rot: [-0.35, -0.5, 0],
      })
      .box(0.16, 0.05, 0.05, { color: 0xdcdcd8 })
      .build();
    this.boatSpots = seaLifeSpots(hf, count);
    this.gullSpots = seaLifeSpots(hf, Math.round(count / 2), 911);
    this.boats = new InstancedMesh(
      boatGeo,
      material,
      Math.max(1, this.boatSpots.length),
    );
    this.gulls = new InstancedMesh(
      gullGeo,
      material,
      Math.max(1, this.gullSpots.length),
    );
    this.boats.count = this.boatSpots.length;
    this.gulls.count = this.gullSpots.length;
    for (const mesh of [this.boats, this.gulls]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    this.group.name = "sea-life";
  }

  update(timeSec: number, cameraDistance: number): void {
    const visible = cameraDistance < HIDE_DISTANCE;
    this.group.visible = visible;
    if (!visible) return;
    const grow = Math.max(1, Math.min(2.5, cameraDistance / 120));
    for (let i = 0; i < this.boatSpots.length; i++) {
      const b = this.boatSpots[i];
      const a = b.phase + timeSec * b.speed;
      const x = b.x + Math.cos(a) * b.r;
      const z = b.z + Math.sin(a) * b.r;
      // Heading along the circle; gentle rocking.
      const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)) * Math.sign(b.speed);
      this.e.set(Math.sin(timeSec * 1.4 + b.phase) * 0.08, yaw, 0, "YZX");
      this.q.setFromEuler(this.e);
      this.p.set(x, 0.02 + Math.sin(timeSec * 1.7 + b.phase) * 0.03, z);
      this.s.setScalar(grow);
      this.boats.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    for (let i = 0; i < this.gullSpots.length; i++) {
      const g = this.gullSpots[i];
      const a = g.phase + timeSec * g.speed * 4;
      const x = g.x + Math.cos(a) * g.r * 1.5;
      const z = g.z + Math.sin(a) * g.r * 1.5;
      const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)) * Math.sign(g.speed);
      // Bank into the circle; wings flap by squashing the height.
      this.e.set(0.35 * Math.sign(g.speed), yaw, 0, "YZX");
      this.q.setFromEuler(this.e);
      this.p.set(x, 2.5 + Math.sin(timeSec * 0.7 + g.phase) * 0.6, z);
      const flap = 0.6 + 0.4 * Math.abs(Math.sin(timeSec * 7 + g.phase));
      this.s.set(grow, grow * flap, grow * (0.7 + 0.3 * flap));
      this.gulls.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.boats.instanceMatrix.needsUpdate = true;
    this.gulls.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.boats.geometry.dispose();
    this.gulls.geometry.dispose();
    (this.boats.material as MeshStandardMaterial).dispose();
  }
}
