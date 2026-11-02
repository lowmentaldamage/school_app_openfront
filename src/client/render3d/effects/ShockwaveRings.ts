/**
 * ShockwaveRings — expanding ground-hugging blast rings, one instanced draw
 * call for all of them. Each ring's expansion and fade run in the shader
 * from its birth time and radius; the CPU only writes a slot on spawn.
 */

import {
  AdditiveBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  RingGeometry,
  ShaderMaterial,
} from "three";

const VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aRing; // birth, duration, radius
varying float vT;
varying float vR;
void main() {
  float t = (uTime - aRing.x) / aRing.y;
  vT = t;
  vR = length(position.xz);
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float r = aRing.z * (1.0 - pow(1.0 - t, 3.0));
  vec3 p = vec3(position.x * r, position.y, position.z * r);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
varying float vT;
varying float vR;
void main() {
  float edge = smoothstep(0.78, 0.95, vR) * (1.0 - smoothstep(0.95, 1.0, vR));
  float a = edge * pow(1.0 - vT, 1.6);
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * a, a);
}
`;

export class ShockwaveRings {
  readonly mesh: InstancedMesh;
  private readonly ring: Float32Array;
  private readonly attr: InstancedBufferAttribute;
  private readonly uniforms = { uTime: { value: 0 } };
  private next = 0;
  private readonly m = new Matrix4();

  constructor(private readonly capacity = 48) {
    const geom = new RingGeometry(0.75, 1, 48, 1);
    geom.rotateX(-Math.PI / 2);
    this.ring = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.ring[i * 3] = -1e6;
    this.attr = new InstancedBufferAttribute(this.ring, 3);
    geom.setAttribute("aRing", this.attr);
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geom, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.m);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    radius: number,
    duration: number,
    now: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.ring[i * 3] = now;
    this.ring[i * 3 + 1] = duration;
    this.ring[i * 3 + 2] = radius;
    this.attr.needsUpdate = true;
    this.m.makeTranslation(x, y + 0.15, z);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(timeSeconds: number): void {
    this.uniforms.uTime.value = timeSeconds;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.mesh.dispose();
  }
}
