/**
 * StructureMarkers — a small, always-readable icon for every building: the
 * building's white icon on its owner's colour.
 *
 *  - 3D view (zoomed in): a round badge floating above each model.
 *  - 2D icon mode (zoomed out): a rounded square on the building's spot,
 *    replacing the model, like the classic 2D map.
 *
 * Icons have a constant size in screen pixels (they never grow near the
 * camera), and icons that would overlap on screen merge into one with a
 * small count ("2" … "9", "9+") until you zoom in. One instanced draw
 * call; icons come from the game's white SVGs, packed into one atlas.
 */

import { assetUrl } from "@laukolaroser/shared/AssetUrls";
import {
  type Camera,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
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
  flakGun: "images/FlakIconWhite.svg",
  fort: "images/FortIconWhite.svg",
  coastalBattery: "images/CoastalBatteryIconWhite.svg",
};

export const MARKER_KINDS = Object.keys(ICONS) as ModelKind[];

/** Count glyphs drawn into the atlas after the icons. */
const COUNT_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "9+"];

const CELL = 96;
const COLS = 4;

/** On-screen size in CSS pixels. */
export const ICON_PX_FLAT = 22;
export const ICON_PX_BADGE = 19;
const COUNT_PX = 11;

const VERT = /* glsl */ `
attribute float aCell;
attribute float aPx;
attribute vec2 aOff;
attribute float aKind;
uniform float uLift;
uniform float uFlat;
uniform vec2 uViewport;
varying vec2 vUv;
varying float vCell;
varying float vKind;
varying vec3 vColor;
void main() {
  vec4 view = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Badges float above their building; 2D icons sit on its spot.
  view.y += uLift * (1.0 - uFlat);
  vec4 clip = projectionMatrix * view;
  // Constant on-screen size: offset in pixels, scaled by w.
  vec2 px = position.xy * aPx + aOff;
  clip.xy += px * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vUv = uv;
  vCell = aCell;
  vKind = aKind;
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
uniform float uFlat;
varying vec2 vUv;
varying float vCell;
varying float vKind;
varying vec3 vColor;
void main() {
  vec2 c = vUv - 0.5;
  vec2 q = abs(c) * 2.0;
  // Icons: a disc (badge) or a rounded square (2D icon); counts: a disc.
  float square = uFlat * (1.0 - vKind);
  float sq = length(max(q - 0.62, 0.0)) / 0.38;
  float r = mix(length(c) * 2.0, sq, square);
  float shape = 1.0 - smoothstep(0.9, 1.0, r);
  if (shape <= 0.0) discard;
  float edge = mix(r, max(q.x, q.y), square);
  // A white ring inside a dark outline: readable on any territory colour,
  // including the owner's own (a red icon on red land).
  float light = smoothstep(0.66, 0.72, edge) * (1.0 - smoothstep(0.80, 0.84, edge));
  float ring = smoothstep(0.82, 0.88, edge);
  vec2 iuv = (vUv - 0.5) * mix(1.3, 1.2, vKind) + 0.5;
  float glyph = 0.0;
  if (iuv.x > 0.0 && iuv.x < 1.0 && iuv.y > 0.0 && iuv.y < 1.0) {
    // Round: an interpolated 8.0 can arrive as 7.9999, which would pick
    // the wrong (empty) atlas cell — a blank icon.
    float cell = floor(vCell + 0.5);
    float col = cell - ${COLS.toFixed(1)} * floor(cell / ${COLS.toFixed(1)});
    float row = floor(cell / ${COLS.toFixed(1)});
    vec2 cellUv = vec2(
      (col + iuv.x) / ${COLS.toFixed(1)},
      1.0 - (row + 1.0 - iuv.y) / uRows
    );
    glyph = texture2D(uAtlas, cellUv).a;
  }
  // instanceColor is linear; this material writes display colours.
  // Owner colour, darkened so the white glyph and ring stand out.
  vec3 bg = pow(max(vColor, vec3(0.0)), vec3(1.0 / 2.2)) * 0.62;
  vec3 col = mix(bg, vec3(1.0), glyph);
  col = mix(col, vec3(0.96), light * (1.0 - vKind) * 0.9);
  col = mix(col, vec3(0.02), ring * 0.92);
  gl_FragColor = vec4(col, shape * uOpacity);
}
`;

const COUNT_BG = new Color(0.02, 0.02, 0.025);

export class StructureMarkers {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly cells: InstancedBufferAttribute;
  private readonly pxs: InstancedBufferAttribute;
  private readonly offs: InstancedBufferAttribute;
  private readonly kinds: InstancedBufferAttribute;
  private readonly cellOf = new Map<ModelKind, number>();
  private readonly countCell: number;
  private readonly capacity: number;
  /** Markers pushed this tick (world position, atlas cell, colour). */
  private n = 0;
  private pos: Float32Array;
  private cellArr: Uint8Array;
  private colors: Color[] = [];
  private flat = false;
  private readonly m = new Matrix4();
  private readonly v = new Vector3();

  constructor(capacity = 4096) {
    this.capacity = capacity;
    const total = MARKER_KINDS.length + COUNT_LABELS.length;
    const rows = Math.ceil(total / COLS);
    const canvas = document.createElement("canvas");
    canvas.width = CELL * COLS;
    canvas.height = CELL * rows;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    // Mipmaps: at 13-16 px a thin icon (the oil rig's lines) would
    // otherwise be skipped by the sampler and show as a blank tile.
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    const ctx = canvas.getContext("2d");
    const at = (i: number) => [(i % COLS) * CELL, Math.floor(i / COLS) * CELL];
    MARKER_KINDS.forEach((kind, i) => {
      this.cellOf.set(kind, i);
      const img = new Image();
      img.onload = () => {
        if (!ctx) return;
        const [x, y] = at(i);
        ctx.drawImage(img, x + 6, y + 6, CELL - 12, CELL - 12);
        texture.needsUpdate = true;
      };
      img.src = assetUrl(ICONS[kind]!);
    });
    this.countCell = MARKER_KINDS.length;
    if (ctx) {
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      COUNT_LABELS.forEach((label, k) => {
        const [x, y] = at(this.countCell + k);
        ctx.font = `bold ${label.length > 1 ? 56 : 70}px sans-serif`;
        ctx.fillText(label, x + CELL / 2, y + CELL / 2 + 4);
      });
      texture.needsUpdate = true;
    }

    this.material = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: texture },
        uLift: { value: 2 },
        uOpacity: { value: 0.95 },
        uRows: { value: rows },
        uFlat: { value: 0 },
        uViewport: { value: [1, 1] },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const geo = new PlaneGeometry(1, 1);
    // Every marker may need an icon and a count badge.
    const slots = capacity * 2;
    this.mesh = new InstancedMesh(geo, this.material, slots);
    this.mesh.name = "structure-markers";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const attr = (size: number) => {
      const a = new InstancedBufferAttribute(
        new Float32Array(slots * size),
        size,
      );
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.cells = attr(1);
    this.pxs = attr(1);
    this.offs = attr(2);
    this.kinds = attr(1);
    geo.setAttribute("aCell", this.cells);
    geo.setAttribute("aPx", this.pxs);
    geo.setAttribute("aOff", this.offs);
    geo.setAttribute("aKind", this.kinds);
    this.mesh.setColorAt(0, new Color(1, 1, 1));
    this.mesh.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.cellArr = new Uint8Array(capacity);
  }

  begin(): void {
    this.n = 0;
  }

  /** Add a marker; `color` is the owner's colour. */
  push(kind: ModelKind, x: number, y: number, z: number, color: Color): void {
    const cell = this.cellOf.get(kind);
    if (cell === undefined || this.n >= this.capacity) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.cellArr[i] = cell;
    const c = this.colors[i];
    if (c) c.copy(color);
    else this.colors[i] = color.clone();
  }

  end(): void {
    // Laid out per frame in layout().
  }

  /**
   * Per frame: badge lift from the camera distance, 2D icon mode, and the
   * visibility of the whole layer.
   */
  setView(cameraDistance: number, visible: boolean, flat = false): void {
    const u = this.material.uniforms;
    u.uLift.value = Math.max(1.6, cameraDistance * 0.012);
    u.uFlat.value = flat ? 1 : 0;
    this.flat = flat;
    this.mesh.visible = visible;
  }

  /**
   * Per frame: project every marker to the screen and merge those that
   * would overlap into one icon with a count. `width` / `height` are the
   * canvas size in CSS pixels.
   */
  layout(camera: Camera, width: number, height: number): void {
    this.material.uniforms.uViewport.value = [width, height];
    if (!this.mesh.visible) return;
    const iconPx = this.flat ? ICON_PX_FLAT : ICON_PX_BADGE;
    const groups = groupMarkers(
      this.n,
      (i) => {
        this.v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
        this.v.project(camera);
        if (this.v.z > 1 || this.v.z < -1) return null;
        return [((this.v.x + 1) / 2) * width, ((1 - this.v.y) / 2) * height];
      },
      width,
      height,
      iconPx * 1.15,
    );
    let slot = 0;
    for (const g of groups) {
      const i = g.first;
      this.m.makeTranslation(
        this.pos[i * 3],
        this.pos[i * 3 + 1],
        this.pos[i * 3 + 2],
      );
      this.mesh.setMatrixAt(slot, this.m);
      this.mesh.setColorAt(slot, this.colors[i]);
      this.cells.setX(slot, this.cellArr[i]);
      this.pxs.setX(slot, iconPx);
      this.offs.setXY(slot, 0, 0);
      this.kinds.setX(slot, 0);
      slot++;
      if (g.count > 1) {
        this.mesh.setMatrixAt(slot, this.m);
        this.mesh.setColorAt(slot, COUNT_BG);
        this.cells.setX(slot, this.countCell + Math.min(g.count, 10) - 2);
        this.pxs.setX(slot, COUNT_PX);
        // Top-right corner of the icon.
        this.offs.setXY(slot, iconPx * 0.45, iconPx * 0.45);
        this.kinds.setX(slot, 1);
        slot++;
      }
    }
    this.mesh.count = slot;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.cells.needsUpdate = true;
    this.pxs.needsUpdate = true;
    this.offs.needsUpdate = true;
    this.kinds.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.material.uniforms.uAtlas.value as CanvasTexture).dispose();
    this.material.dispose();
  }
}

export interface MarkerGroup {
  /** The marker drawn for the group. */
  first: number;
  count: number;
}

/**
 * Screen-space grouping: markers whose screen positions fall within
 * `cellPx` of a group's first marker join that group. Off-screen markers
 * (null position or outside the view) are dropped. Pure; tested.
 */
export function groupMarkers(
  n: number,
  screenPos: (i: number) => [number, number] | null,
  width: number,
  height: number,
  cellPx: number,
): MarkerGroup[] {
  const groups: (MarkerGroup & { x: number; y: number })[] = [];
  const grid = new Map<number, number[]>();
  const cols = Math.max(1, Math.ceil(width / cellPx) + 2);
  const key = (cx: number, cy: number) => cy * cols + cx;
  for (let i = 0; i < n; i++) {
    const p = screenPos(i);
    if (p === null) continue;
    const [x, y] = p;
    if (x < -cellPx || y < -cellPx || x > width + cellPx || y > height + cellPx)
      continue;
    const cx = Math.floor(x / cellPx) + 1;
    const cy = Math.floor(y / cellPx) + 1;
    let joined = false;
    for (let dy = -1; dy <= 1 && !joined; dy++) {
      for (let dx = -1; dx <= 1 && !joined; dx++) {
        const list = grid.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (const gi of list) {
          const g = groups[gi];
          if (Math.abs(g.x - x) < cellPx && Math.abs(g.y - y) < cellPx) {
            g.count++;
            joined = true;
            break;
          }
        }
      }
    }
    if (joined) continue;
    const gi = groups.length;
    groups.push({ first: i, count: 1, x, y });
    const k = key(cx, cy);
    const list = grid.get(k);
    if (list) list.push(gi);
    else grid.set(k, [gi]);
  }
  return groups;
}
