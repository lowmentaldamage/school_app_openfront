/**
 * StructureMarkers — a small, always-readable icon badge above every
 * building: the building's icon in white on a disc of the owner's colour.
 *
 * One instanced, camera-facing quad per building (one draw call), drawn on
 * top of the terrain with a constant on-screen size, so at any zoom you can
 * tell a silo from a city at a glance. Icons come from the game's own
 * white SVG icons, packed into one atlas texture.
 */

import { assetUrl } from "@laukolaroser/shared/AssetUrls";
import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
} from "three";
import type { ModelKind } from "./UnitModels";

/** Icon per building kind (white SVGs in resources/images). */
const ICONS: Partial<Record<ModelKind, string>> = {
  city: "images/CityIconWhite.svg",
  factory: "images/FactoryIconWhite.svg",
  port: "images/PortIcon.svg",
  defensePost: "images/ShieldIconWhite.svg",
  samLauncher: "images/SamLauncherIconWhite.svg",
  missileSilo: "images/MissileSiloIconWhite.svg",
  goldMine: "images/GoldMineIconWhite.svg",
  market: "images/MarketIconWhite.svg",
  oilRig: "images/OilRigIconWhite.svg",
  airbase: "images/AirbaseIconWhite.svg",
  radarStation: "images/RadarIconWhite.svg",
};

export const MARKER_KINDS = Object.keys(ICONS) as ModelKind[];

const CELL = 96;
const COLS = 4;

const VERT = /* glsl */ `
attribute float aCell;
uniform float uSize;
uniform float uLift;
varying vec2 vUv;
varying float vCell;
varying vec3 vColor;
void main() {
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Float above the building, then a camera-facing quad of constant
  // on-screen size (uSize grows with the camera distance).
  center.y += uLift;
  center.xy += position.xy * uSize;
  gl_Position = projectionMatrix * center;
  vUv = uv;
  vCell = aCell;
#ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
#else
  vColor = vec3(0.6);
#endif
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uOpacity;
uniform float uRows;
varying vec2 vUv;
varying float vCell;
varying vec3 vColor;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float disc = 1.0 - smoothstep(0.9, 1.0, r);
  if (disc <= 0.0) discard;
  float ring = smoothstep(0.78, 0.86, r);
  // Icon inset in the disc; atlas cell (canvas rows run top-down, the
  // texture is flipped so v = 1 is the top).
  vec2 iuv = (vUv - 0.5) * 1.4 + 0.5;
  float icon = 0.0;
  if (iuv.x > 0.0 && iuv.x < 1.0 && iuv.y > 0.0 && iuv.y < 1.0) {
    float col = mod(vCell, ${COLS.toFixed(1)});
    float row = floor(vCell / ${COLS.toFixed(1)} + 0.001);
    vec2 cellUv = vec2(
      (col + iuv.x) / ${COLS.toFixed(1)},
      1.0 - (row + 1.0 - iuv.y) / uRows
    );
    icon = texture2D(uAtlas, cellUv).a;
  }
  // instanceColor is linear; this material writes display colours directly.
  vec3 bg = pow(max(vColor, vec3(0.0)), vec3(1.0 / 2.2)) * 0.82;
  vec3 col = mix(bg, vec3(1.0), icon);
  col = mix(col, vec3(0.03), ring * 0.85);
  gl_FragColor = vec4(col, disc * uOpacity);
}
`;

export class StructureMarkers {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly cells: InstancedBufferAttribute;
  private readonly cellOf = new Map<ModelKind, number>();
  private count = 0;
  private readonly m = new Matrix4();

  constructor(capacity = 4096) {
    const rows = Math.ceil(MARKER_KINDS.length / COLS);
    const canvas = document.createElement("canvas");
    canvas.width = CELL * COLS;
    canvas.height = CELL * rows;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    const ctx = canvas.getContext("2d");
    MARKER_KINDS.forEach((kind, i) => {
      this.cellOf.set(kind, i);
      const img = new Image();
      img.onload = () => {
        if (!ctx) return;
        const x = (i % COLS) * CELL;
        const y = Math.floor(i / COLS) * CELL;
        ctx.drawImage(img, x + 6, y + 6, CELL - 12, CELL - 12);
        texture.needsUpdate = true;
      };
      img.src = assetUrl(ICONS[kind]!);
    });

    this.material = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: texture },
        uSize: { value: 1 },
        uLift: { value: 2 },
        uOpacity: { value: 0.95 },
        uRows: { value: rows },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const geo = new PlaneGeometry(1, 1);
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.name = "structure-markers";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cells = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.cells.setUsage(DynamicDrawUsage);
    geo.setAttribute("aCell", this.cells);
    // Allocate instanceColor.
    this.mesh.setColorAt(0, new Color(1, 1, 1));
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** Add a marker; `color` is the owner's colour (sRGB). */
  push(kind: ModelKind, x: number, y: number, z: number, color: Color): void {
    const cell = this.cellOf.get(kind);
    if (cell === undefined || this.count >= this.mesh.instanceMatrix.count) {
      return;
    }
    this.m.makeTranslation(x, y, z);
    this.mesh.setMatrixAt(this.count, this.m);
    this.mesh.setColorAt(this.count, color);
    this.cells.setX(this.count, cell);
    this.count++;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.cells.needsUpdate = true;
  }

  /**
   * Per frame: badge size from the camera distance (constant on screen),
   * and how high above the ground it floats.
   */
  setView(cameraDistance: number, visible: boolean): void {
    const u = this.material.uniforms;
    u.uSize.value = Math.max(0.9, cameraDistance * 0.028);
    u.uLift.value = Math.max(1.6, cameraDistance * 0.012);
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.material.uniforms.uAtlas.value as CanvasTexture).dispose();
    this.material.dispose();
  }
}
