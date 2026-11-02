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
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";

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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float sun = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.85, 0.6) * (pow(sun, 64.0) * 0.9 + pow(sun, 6.0) * 0.12);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class EnvironmentRenderer {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  private readonly fog: FogExp2;
  private readonly sky: Mesh;

  constructor(
    private readonly scene: Scene,
    quality: QualitySettings,
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
    this.sun.shadow.normalBias = 0.3;
    scene.add(this.sun);
    scene.add(this.sun.target);
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
  ): void {
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.5);
    const r = Math.max(20, viewRadius * 1.2);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, r * 2 + 50);
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
    this.fog.density = 0.55 / Math.max(50, cameraDistance * 2.2);
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
    this.scene.remove(this.sun, this.sun.target, this.hemi, this.sky);
    this.sky.geometry.dispose();
    (this.sky.material as ShaderMaterial).dispose();
    this.scene.fog = null;
  }
}
