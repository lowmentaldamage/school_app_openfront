/**
 * EnvironmentRenderer — sky, atmospheric fog and lighting.
 *
 * One directional "sun" casts shadows. Rather than a single shadow map
 * stretched over the whole (possibly 6000-tile) map, the shadow camera is
 * re-centred on the camera's focus point every frame and sized to the
 * visible area, so shadow resolution tracks zoom. Fog density also scales
 * with view distance so zoomed-out views stay readable while close views
 * get depth haze. A sky dome (zenith → horizon gradient with a sun glow)
 * follows the camera; the fog colour matches its horizon so distant
 * terrain melts into the sky instead of ending at an edge.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  LineSegments,
  Mesh,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import {
  atmosphereAt,
  type AtmosphereOptions,
  type AtmosphereState,
} from "./Atmosphere";

const RAIN_VERT = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform float uBox;
uniform vec3 uCenter;
uniform float uLen;
varying float vEnd;
void main() {
  // position: x/z offset in [-0.5, 0.5], y = phase in [0, 1).
  float fall = fract(position.y - uTime * 0.9);
  vec3 p = uCenter + vec3(position.x * uBox, fall * uBox * 0.6, position.z * uBox);
  p.y -= aEnd * uLen;
  p.x -= aEnd * uLen * 0.25; // slanted by wind
  vEnd = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
uniform float uAlpha;
varying float vEnd;
void main() {
  gl_FragColor = vec4(0.72, 0.78, 0.86, uAlpha * (1.0 - vEnd * 0.7));
}
`;

/** Camera-following rain streaks: one LineSegments draw call. */
class RainRenderer {
  readonly mesh: LineSegments;
  private readonly material: ShaderMaterial;

  constructor(private readonly count: number) {
    const pos = new Float32Array(count * 6);
    const end = new Float32Array(count * 2);
    let s = 12345;
    const rnd = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const x = rnd() - 0.5;
      const z = rnd() - 0.5;
      const y = rnd();
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("aEnd", new BufferAttribute(end, 1));
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: 100 },
        uCenter: { value: new Vector3() },
        uLen: { value: 2 },
        uAlpha: { value: 0 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.mesh = new LineSegments(geo, this.material);
    this.mesh.name = "rain";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  update(
    amount: number,
    camera: PerspectiveCamera,
    focus: Vector3,
    cameraDistance: number,
    timeSec: number,
  ): void {
    // Rain is for close-up atmosphere only: it thins out as the camera
    // climbs and is gone at strategic zoom, so it never washes out the map.
    const t = Math.min(1, Math.max(0, (cameraDistance - 60) / (220 - 60)));
    const fade = 1 - t * t * (3 - 2 * t);
    amount *= fade;
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    const u = this.material.uniforms;
    // A box between the camera and the ground, sized to the zoom.
    const box = Math.max(30, cameraDistance * 0.9);
    const c = u.uCenter.value as Vector3;
    c.copy(camera.position).lerp(focus, 0.55);
    c.y -= box * 0.3;
    u.uBox.value = box;
    u.uLen.value = box * 0.025;
    u.uTime.value = timeSec;
    u.uAlpha.value = 0.22 * amount;
    // Light rain draws fewer streaks.
    const n = Math.ceil(this.count * Math.min(1, 0.3 + amount));
    this.mesh.geometry.setDrawRange(0, n * 2);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export interface QualitySettings {
  shadows: boolean;
  shadowMapSize: number;
}

const HORIZON = new Color(0xc9dce6);
const ZENITH = new Color(0x3f7fc4);
const SUN_DIR = new Vector3(-0.55, 0.75, -0.35).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uSunGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float sun = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.85, 0.6) * (pow(sun, 64.0) * 0.9 + pow(sun, 6.0) * 0.12) * uSunGlow;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class EnvironmentRenderer {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  private readonly fog: FogExp2;
  private readonly sky: Mesh;
  private readonly rain: RainRenderer;
  private readonly sunDir = SUN_DIR.clone();
  private fogMul = 1;
  private options: AtmosphereOptions = { dayNight: false, weather: false };
  private tick = 0;
  private tickAtMs = 0;
  private seed = 0;
  /** Last applied state (for tests and the HUD). */
  state: AtmosphereState | null = null;

  constructor(
    private readonly scene: Scene,
    quality: QualitySettings,
    rainDrops = 3000,
  ) {
    scene.background = HORIZON.clone();
    this.fog = new FogExp2(HORIZON.getHex(), 0.0015);
    scene.fog = this.fog;

    this.sky = new Mesh(
      new SphereGeometry(1, 24, 12),
      new ShaderMaterial({
        uniforms: {
          uZenith: { value: ZENITH.clone() },
          uHorizon: { value: HORIZON.clone() },
          uSunDir: { value: SUN_DIR.clone() },
          uSunGlow: { value: 1 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.name = "sky";
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.hemi = new HemisphereLight(0xdfeeff, 0x4a3f2c, 1.1);
    scene.add(this.hemi);

    this.sun = new DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    // Soft shadows: mountains shade the valleys without turning them black.
    this.sun.shadow.intensity = 0.62;
    this.sun.shadow.normalBias = 0.3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.rain = new RainRenderer(rainDrops);
    scene.add(this.rain.mesh);
  }

  /** The sky's material (shared with the reflection-map scene). */
  get skyMaterial(): ShaderMaterial {
    return this.sky.material as ShaderMaterial;
  }

  /** Day/night and weather switches (user settings). */
  setOptions(options: AtmosphereOptions, seed = 0): void {
    this.options = { ...options };
    this.seed = seed;
  }

  /** The latest game tick; the sky interpolates between ticks. */
  setTick(tick: number, nowMs: number): void {
    this.tick = tick;
    this.tickAtMs = nowMs;
  }

  private applyAtmosphere(nowMs: number): void {
    const frac = Math.min(1, Math.max(0, (nowMs - this.tickAtMs) / 100));
    const a = atmosphereAt(this.tick + frac, this.options, this.seed);
    this.state = a;
    this.sunDir.set(a.sunDir[0], a.sunDir[1], a.sunDir[2]);
    this.sun.color.setRGB(
      a.sunColor[0],
      a.sunColor[1],
      a.sunColor[2],
      SRGBColorSpace,
    );
    this.sun.intensity = a.sunIntensity;
    this.hemi.color.setRGB(
      a.hemiSky[0],
      a.hemiSky[1],
      a.hemiSky[2],
      SRGBColorSpace,
    );
    this.hemi.groundColor.setRGB(
      a.hemiGround[0],
      a.hemiGround[1],
      a.hemiGround[2],
      SRGBColorSpace,
    );
    this.hemi.intensity = a.hemiIntensity;
    const u = (this.sky.material as ShaderMaterial).uniforms;
    (u.uZenith.value as Color).setRGB(
      a.zenith[0],
      a.zenith[1],
      a.zenith[2],
      SRGBColorSpace,
    );
    (u.uHorizon.value as Color).setRGB(
      a.horizon[0],
      a.horizon[1],
      a.horizon[2],
      SRGBColorSpace,
    );
    (u.uSunDir.value as Vector3).copy(this.sunDir);
    u.uSunGlow.value = (1 - a.cloud) * (a.daylight > 0 ? 1 : 0.25);
    this.fog.color.copy(u.uHorizon.value as Color);
    (this.scene.background as Color).copy(u.uHorizon.value as Color);
    this.fogMul = a.fogMul;
  }

  /**
   * Re-fit the sun's shadow frustum around the camera focus.
   * @param focus world-space point the camera looks at
   * @param viewRadius approx. radius (world units) of the visible ground
   * @param cameraDistance distance from camera to focus
   */
  update(
    focus: Vector3,
    viewRadius: number,
    cameraDistance: number,
    camera: PerspectiveCamera,
    nowMs = performance.now(),
  ): void {
    this.applyAtmosphere(nowMs);
    this.rain.update(
      this.state?.rain ?? 0,
      camera,
      focus,
      cameraDistance,
      nowMs / 1000,
    );
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.5);
    const r = Math.max(20, viewRadius * 1.2);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, r * 2 + 50);
    const cam = this.sun.shadow.camera;
    if (cam.right !== r) {
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = r * 4 + 120;
      cam.updateProjectionMatrix();
    }
    this.sun.target.updateMatrixWorld();
    // Keep fog roughly proportional to view distance: haze begins to bite
    // at ~2× the camera distance whatever the zoom.
    this.fog.density =
      (0.55 * this.fogMul) / Math.max(50, cameraDistance * 2.2);
  }

  setQuality(quality: QualitySettings): void {
    this.sun.castShadow = quality.shadows;
    if (this.sun.shadow.mapSize.x !== quality.shadowMapSize) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.scene.remove(
      this.sun,
      this.sun.target,
      this.hemi,
      this.sky,
      this.rain.mesh,
    );
    this.rain.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as ShaderMaterial).dispose();
    this.scene.fog = null;
  }
}
