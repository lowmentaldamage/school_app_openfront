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
 * fades: ship wakes, splashes), 5 = dust (ground-hugging, brown, rolls out),
 * 6 = debris (dark tumbling chunks, ballistic), 7 = scorch (burnt ground
 * that stays a while). Shapes come from procedural noise in the fragment
 * shader (billowing lit smoke, turbulent blackbody fire, streak sparks), so
 * no texture assets are needed.
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
export const P_DEBRIS = 6;
export const P_SCORCH = 7;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelScale;
attribute vec3 aVel;
attribute vec4 aParams; // birth, life, size, kind
attribute float aSeed;
varying float vT;
varying float vKind;
varying float vSeed;
varying float vAge;
varying vec2 vDir;     // screen direction of travel (sparks)
varying float vStretch; // streak length / width (sparks)
void main() {
  float age = uTime - aParams.x;
  float t = age / aParams.y;
  vKind = aParams.w;
  vSeed = aSeed;
  vT = t;
  vAge = age;
  vDir = vec2(1.0, 0.0);
  vStretch = 1.0;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = position;
  vec3 v = aVel;
  float size = aParams.z;
  if (vKind < 0.5) {            // fire: decelerating burst, rises as it cools
    p += aVel * (1.0 - exp(-age * 3.0)) / 3.0 + vec3(0.0, 0.8 * age * age, 0.0);
    size *= 0.6 + 0.9 * sin(min(t * 2.2, 1.0) * 1.5708);
  } else if (vKind < 1.5) {     // spark: ballistic with drag and gravity
    float drag = (1.0 - exp(-age * 1.4)) / 1.4;
    p += aVel * drag + vec3(0.0, -11.0, 0.0) * age * age * 0.5;
    v = aVel * exp(-age * 1.4) + vec3(0.0, -11.0 * age, 0.0);
    p.y = max(p.y, position.y - 0.15);
    size *= 1.0 - t * 0.6;
  } else if (vKind < 2.5) {     // smoke: drifts, rises, billows out
    p += aVel * (1.0 - exp(-age * 1.2)) / 1.2 + vec3(0.0, 0.6 * age, 0.0);
    size *= 0.5 + 1.5 * sqrt(t);
  } else if (vKind < 3.5) {     // flash
    size *= 0.4 + 0.6 * t;
  } else if (vKind < 4.5) {     // foam / spray: thrown up, falls back
    p += aVel * (1.0 - exp(-age * 2.0)) / 2.0;
    // Spray thrown upward falls back to the water.
    p.y -= 4.0 * age * age * step(0.5, aVel.y);
    p.y = max(p.y, position.y);
    size *= 0.6 + 1.2 * t;
  } else if (vKind < 5.5) {     // dust: rolls outward along the ground
    p += aVel * (1.0 - exp(-age * 1.6)) / 1.6 + vec3(0.0, 0.25 * age, 0.0);
    size *= 0.7 + 1.6 * sqrt(t);
  } else if (vKind < 6.5) {     // debris: heavy chunks, ballistic, land and rest
    p += aVel * age + vec3(0.0, -14.0, 0.0) * age * age * 0.5;
    p.y = max(p.y, position.y - 0.2);
  } else {                      // scorch: stays on the ground
    p.y += 0.05;
    size *= min(1.0, t * 12.0);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float px = size * uPixelScale / max(-mv.z, 0.1);
  // Pull the sprite toward the camera by half its size so it never slices
  // into the ground or a building (no hard straight edges).
  if (vKind < 6.5) mv.xyz += normalize(-mv.xyz) * size * 0.5;
  gl_Position = projectionMatrix * mv;
  if (vKind > 0.5 && vKind < 1.5) {
    // Streak: point the sprite along the projected velocity and grow it
    // to hold the streak (the fragment shader draws a thin line).
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(p + v * 0.06, 1.0);
    vec2 sa = gl_Position.xy / gl_Position.w;
    vec2 sb = ahead.xy / ahead.w;
    vec2 d = (sb - sa) * 0.5 * uPixelScale;
    float len = length(d);
    vDir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
    vStretch = clamp(1.0 + len / max(px, 1.0), 1.0, 6.0);
    px *= vStretch;
  }
  gl_PointSize = min(px, 768.0);
}
`;

const FRAG = /* glsl */ `
uniform float uDetail; // 1 full noise, 0 cheap (phones on low quality)
varying float vT;
varying float vKind;
varying float vSeed;
varying float vAge;
varying vec2 vDir;
varying float vStretch;

float pHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float pNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1, 0)), u.x),
             mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), u.x), u.y);
}
float pFbm(vec2 p) {
  float v = 0.5 * pNoise(p);
  if (uDetail > 0.5) {
    v += 0.25 * pNoise(p * 2.07 + 13.1);
    v += 0.125 * pNoise(p * 4.13 + 27.7);
    return v / 0.875;
  }
  return v / 0.5;
}
vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
// Blackbody-ish ramp: 1 white-hot, 0.7 yellow, 0.45 orange, 0.2 red, 0 soot.
vec3 heat(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(vec3(0.08, 0.02, 0.01), vec3(0.75, 0.12, 0.02), smoothstep(0.0, 0.25, h));
  c = mix(c, vec3(1.0, 0.45, 0.06), smoothstep(0.2, 0.5, h));
  c = mix(c, vec3(1.0, 0.82, 0.35), smoothstep(0.45, 0.75, h));
  return mix(c, vec3(1.0, 0.98, 0.9), smoothstep(0.75, 1.0, h));
}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  d.y = -d.y;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  vec3 col;
  float a;
  if (vKind < 0.5) {
    // Fire: turbulent flame that rises and cools.
    vec2 q = rot(d, vSeed * 6.28) * 3.0 + vec2(vSeed * 17.0, -vAge * 2.5);
    float n = pFbm(q);
    float body = 1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.9);
    float h = body * (1.05 - vT * 1.15) + (n - 0.5) * 0.35;
    col = heat(h) * 0.85;
    a = body * smoothstep(0.02, 0.2, h) * (1.0 - vT * vT) * 0.8;
  } else if (vKind < 1.5) {
    // Spark: a hot streak along the direction of flight.
    vec2 q = vec2(dot(d, vDir), dot(d, vec2(-vDir.y, vDir.x)));
    float along = q.x * 2.0;                 // -1 tail .. +1 head
    float across = abs(q.y) * 2.0 * vStretch;
    float line = (1.0 - smoothstep(0.0, 0.35, across)) * (1.0 - smoothstep(0.7, 1.0, abs(along)));
    float headGlow = smoothstep(-1.0, 1.0, along);
    col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.95, 0.75), headGlow);
    a = line * (0.35 + 0.65 * headGlow) * (1.0 - vT);
  } else if (vKind < 2.5) {
    // Smoke: billowing puff, lit from the sun side, fire-lit underneath
    // while young; soot darkens it at first, it greys and thins with age.
    vec2 q = rot(d, vSeed * 6.28 + vAge * 0.15) * 2.4 + vSeed * 31.0;
    float n = pFbm(q + vec2(0.0, -vAge * 0.25));
    float edge = r + (n - 0.5) * 1.0;
    float dens = 1.0 - smoothstep(0.15, 1.05, edge);
    dens *= dens * (3.0 - 2.0 * dens);
    // Fake normal: the sphere plus the noise slope.
    float nx = pFbm(q + vec2(0.07, 0.0)) - n;
    float ny = pFbm(q + vec2(0.0, 0.07)) - n;
    vec3 nrm = normalize(vec3(d * 1.6 - vec2(nx, ny) * 6.0, max(0.25, 1.0 - r)));
    float lit = 0.55 + 0.55 * max(0.0, dot(nrm, normalize(vec3(-0.45, 0.7, 0.55))));
    float shade = (0.17 + 0.42 * vT + 0.06 * vSeed) * lit;
    col = vec3(shade, shade * 0.97, shade * 0.94);
    float ember = pow(1.0 - vT, 4.0) * smoothstep(0.2, -0.6, d.y);
    col += vec3(0.9, 0.35, 0.08) * ember * 0.8;
    a = dens * 0.62 * sin(3.14159 * min(1.0, vT * 1.15)) * (1.0 - 0.3 * vT);
  } else if (vKind < 3.5) {
    // Flash: hot core with star rays.
    float ang = atan(d.y, d.x);
    float rays = pow(abs(cos(ang * 4.0 + vSeed * 6.0)), 18.0) * (1.0 - r);
    float core = pow(1.0 - r, 2.5);
    col = vec3(1.0, 0.95, 0.82);
    a = (core * 0.85 + rays * 0.5) * (1.0 - vT) * (1.0 - vT);
  } else if (vKind < 4.5) {
    // Foam / spray: broken white water.
    vec2 q = rot(d, vSeed * 6.28) * 2.6 + vSeed * 9.0;
    float n = pFbm(q);
    float m = 1.0 - smoothstep(0.2, 1.0, r + (n - 0.5) * 0.8);
    col = vec3(0.9, 0.95, 1.0) * (0.9 + 0.15 * n);
    a = m * (0.45 + 0.55 * n) * 0.7 * (1.0 - vT);
  } else if (vKind < 5.5) {
    // Dust: warm, billowy, lit like smoke.
    vec2 q = rot(d, vSeed * 6.28) * 2.2 + vSeed * 23.0;
    float n = pFbm(q + vec2(vAge * 0.2, 0.0));
    float dens = 1.0 - smoothstep(0.1, 1.05, r + (n - 0.5) * 1.0);
    float lit = 0.85 + 0.3 * (n - 0.5) + 0.2 * d.y;
    col = vec3(0.68, 0.6, 0.47) * lit;
    a = dens * 0.4 * sin(3.14159 * vT);
  } else if (vKind < 6.5) {
    // Debris: a dark, jagged chunk tumbling (lit edge).
    vec2 q = rot(d, vSeed * 6.28 + vAge * (4.0 + vSeed * 6.0));
    float sides = 5.0 + floor(vSeed * 3.0);
    float ang = atan(q.y, q.x);
    float poly = cos(3.14159 / sides) / cos(mod(ang, 6.28318 / sides) - 3.14159 / sides);
    if (r > poly * 0.85) discard;
    float lit = 0.5 + 0.5 * clamp(dot(normalize(q + 1e-4), vec2(-0.6, 0.8)), 0.0, 1.0);
    col = vec3(0.24, 0.2, 0.17) * (0.6 + 0.8 * lit);
    a = 1.0 - smoothstep(0.8, 1.0, vT);
  } else {
    // Scorch: burnt ground, ragged edge, fades at the end.
    vec2 q = d * 3.0 + vSeed * 41.0;
    float n = pFbm(q);
    float m = 1.0 - smoothstep(0.45, 1.0, r + (n - 0.5) * 0.7);
    col = mix(vec3(0.05, 0.04, 0.03), vec3(0.16, 0.11, 0.07), n);
    a = m * 0.7 * (1.0 - smoothstep(0.75, 1.0, vT));
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
    uDetail: { value: 1 },
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

  /** 1: full noise detail; 0: cheap (low-quality devices). */
  setDetail(detail: number): void {
    this.uniforms.uDetail.value = detail;
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
