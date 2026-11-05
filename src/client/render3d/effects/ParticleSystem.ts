/**
 * ParticleSystem — a fixed-size GPU particle ring buffer drawn as one
 * THREE.Points draw call.
 *
 * Particles are fire-and-forget: spawning writes their initial state
 * (origin, velocity, birth time, lifetime, size, kind) once; the vertex
 * shader computes position, size, colour and fade from the current time.
 * No per-frame CPU work per particle, no allocation, and only the slots
 * written since the last frame are uploaded.
 *
 * Kinds: 0 = fire (hot core → orange → dark), 1 = spark (bright, falls
 * with gravity and lands on the ground), 2 = smoke (dark, rises, expands),
 * 3 = flash (very short, very large), 4 = foam (white, flat, spreads and
 * fades: ship wakes, splashes), 5 = dust (ground-hugging, brown, rolls out).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Blending,
} from "three";

export const P_FIRE = 0;
export const P_SPARK = 1;
export const P_SMOKE = 2;
export const P_FLASH = 3;
export const P_FOAM = 4;
export const P_DUST = 5;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelScale;
attribute vec3 aVel;
attribute vec4 aParams; // birth, life, size, kind
attribute float aSeed;
varying float vT;
varying float vKind;
varying float vSeed;
void main() {
  float age = uTime - aParams.x;
  float t = age / aParams.y;
  vKind = aParams.w;
  vSeed = aSeed;
  vT = t;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = position;
  float size = aParams.z;
  if (vKind < 0.5) {            // fire: decelerating burst
    p += aVel * (1.0 - exp(-age * 3.0)) / 3.0;
    size *= 0.6 + 0.9 * sin(min(t * 2.2, 1.0) * 1.5708);
  } else if (vKind < 1.5) {     // spark: ballistic with gravity
    // Air drag slows debris; it lands and rests instead of sinking.
    float drag = (1.0 - exp(-age * 1.4)) / 1.4;
    p += aVel * drag + vec3(0.0, -11.0, 0.0) * age * age * 0.5;
    p.y = max(p.y, position.y - 0.15);
    size *= 1.0 - t * 0.8;
  } else if (vKind < 2.5) {     // smoke: drifts, rises, expands
    p += aVel * (1.0 - exp(-age * 1.2)) / 1.2 + vec3(0.0, 0.6 * age, 0.0);
    size *= 0.5 + 1.5 * t;
  } else if (vKind < 3.5) {     // flash
    size *= 0.4 + 0.6 * t;
  } else if (vKind < 4.5) {     // foam: stays on the water, spreads
    p += aVel * (1.0 - exp(-age * 2.0)) / 2.0;
    size *= 0.6 + 1.2 * t;
  } else {                      // dust: rolls outward along the ground
    p += aVel * (1.0 - exp(-age * 1.6)) / 1.6 + vec3(0.0, 0.25 * age, 0.0);
    size *= 0.7 + 1.6 * t;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(size * uPixelScale / max(-mv.z, 0.1), 768.0);
}
`;

const FRAG = /* glsl */ `
varying float vT;
varying float vKind;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float soft = 1.0 - smoothstep(0.35, 1.0, r);
  vec3 col;
  float a;
  if (vKind < 0.5) {
    vec3 hot = vec3(1.0, 0.95, 0.75);
    vec3 mid = vec3(1.0, 0.55, 0.12);
    vec3 cool = vec3(0.45, 0.08, 0.02);
    col = vT < 0.3 ? mix(hot, mid, vT / 0.3) : mix(mid, cool, (vT - 0.3) / 0.7);
    a = soft * pow(1.0 - vT, 1.4);
  } else if (vKind < 1.5) {
    col = vec3(1.0, 0.8, 0.4);
    a = soft * (1.0 - vT);
  } else if (vKind < 2.5) {
    // Dark grey near the fire, lightening to pale grey as it spreads
    // (real smoke and ash, not a black blanket); thinner as it ages.
    float shade = 0.2 + 0.36 * vT + 0.06 * vSeed;
    col = vec3(shade, shade * 0.97, shade * 0.93);
    a = soft * 0.48 * sin(3.14159 * vT) * (1.0 - 0.35 * vT) * (0.7 + 0.3 * vSeed);
  } else if (vKind < 3.5) {
    col = vec3(1.0, 0.97, 0.9);
    a = soft * (1.0 - vT) * (1.0 - vT);
  } else if (vKind < 4.5) {
    col = vec3(0.92, 0.96, 1.0);
    a = soft * 0.55 * (1.0 - vT);
  } else {
    float shade = 0.42 + 0.1 * vSeed;
    col = vec3(shade, shade * 0.86, shade * 0.68);
    a = soft * 0.5 * sin(3.14159 * vT);
  }
  gl_FragColor = vec4(col, a);
}
`;

export class ParticleSystem {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly params: Float32Array;
  private readonly seed: Float32Array;
  private readonly uniforms = {
    uTime: { value: 0 },
    uPixelScale: { value: 500 },
  };
  private head = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;

  constructor(
    readonly capacity: number,
    blending: Blending,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.seed = new Float32Array(capacity);
    // Start every slot expired.
    for (let i = 0; i < capacity; i++) {
      this.params[i * 4] = -1e6;
      this.params[i * 4 + 1] = 1;
    }
    this.geometry.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute("aVel", new BufferAttribute(this.vel, 3));
    this.geometry.setAttribute("aParams", new BufferAttribute(this.params, 4));
    this.geometry.setAttribute("aSeed", new BufferAttribute(this.seed, 1));
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === AdditiveBlending ? 3 : 2;
  }

  static additive(capacity: number): ParticleSystem {
    return new ParticleSystem(capacity, AdditiveBlending);
  }

  static normal(capacity: number): ParticleSystem {
    return new ParticleSystem(capacity, NormalBlending);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    birth: number,
    life: number,
    size: number,
    kind: number,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.head === 0) this.wrapped = true;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.params[i * 4] = birth;
    this.params[i * 4 + 1] = life;
    this.params[i * 4 + 2] = size;
    this.params[i * 4 + 3] = kind;
    this.seed[i] = Math.random();
    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyTo = i;
  }

  /** Per frame: advance time and upload the slots written since last frame. */
  update(timeSeconds: number, pixelScale: number): void {
    this.uniforms.uTime.value = timeSeconds;
    this.uniforms.uPixelScale.value = pixelScale;
    if (this.dirtyFrom < 0) return;
    const full = this.wrapped || this.dirtyTo < this.dirtyFrom;
    const from = full ? 0 : this.dirtyFrom;
    const count = full ? this.capacity : this.dirtyTo - this.dirtyFrom + 1;
    for (const [name, size] of [
      ["position", 3],
      ["aVel", 3],
      ["aParams", 4],
      ["aSeed", 1],
    ] as const) {
      const attr = this.geometry.getAttribute(name) as BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(from * size, count * size);
      attr.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
