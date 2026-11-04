/**
 * UnitRenderer — every ship, train, missile, shell and structure in 3D.
 *
 * Fed once per simulation tick with FrameData.units (and the palette);
 * animated every render frame. All instances of a model kind share one
 * InstancedMesh, so draw calls stay constant (one per kind) however many
 * units exist.
 *
 *  - Ships sit on the water and bob/roll gently; trains follow the terrain.
 *  - Movement is interpolated lastPos → pos across the tick, using the
 *    measured tick interval, so units glide at 60 fps on a 10 Hz sim.
 *  - Nukes, MIRV warheads and shells fly parabolic arcs from where they
 *    were first seen to their target tile, pitched along the arc.
 *  - SAM missiles climb toward the altitude of the missile they intercept.
 *  - Models grow as the camera pulls back so they stay readable.
 */

import {
  type Camera,
  Color,
  Euler,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Heightfield } from "../terrain/Heightfield";
import { InstancedPool } from "./InstancedPool";
import {
  airAltitude,
  airClimbPitch,
  bankFor,
  BUILD_RISE_MS,
  buildRise,
  smoothTo,
  turnRate,
  turnToward,
  wrapAngle,
} from "./Motion";
import { StructureMarkers } from "./StructureMarkers";
import {
  arcAt,
  arcPeak,
  BALLISTIC_KINDS,
  flightProgress,
  modelKindFor,
  SHIP_KINDS,
  AIR_KINDS,
  hiddenSubmarines,
  STRUCTURE_KINDS,
  tileHash,
  TRAIN_KINDS,
  nextIconMode,
  zoomScale,
} from "./UnitKinds";
import { ALL_MODEL_KINDS, modelGeometry, type ModelKind } from "./UnitModels";

/** The UnitState fields this renderer reads. */
export interface UnitInput {
  id: number;
  unitType: string;
  ownerID: number;
  pos: number;
  lastPos: number;
  isActive: boolean;
  waitTicks: number;
  level: number;
  underConstruction: boolean;
  targetTile: number | null;
  targetUnitId: number | null;
  trainType: number | null;
  loaded: boolean | null;
}

interface Mover {
  id: number;
  kind: ModelKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Ballistic origin / target (tile coords), NaN when not ballistic. */
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  targetUnitId: number | null;
  slot: number;
}

const CONSTRUCTION_GREY = new Color(0.55, 0.55, 0.55);

/** A structure currently playing its "rises from the ground" animation. */
interface Rising {
  kind: ModelKind;
  slot: number;
  at: number;
  x: number;
  h: number;
  y: number;
  yaw: number;
  sxz: number;
  sy: number;
}

/** Uniforms shared by every unit and structure. */
export interface UnitMaterialUniforms {
  /** 0 by day, 1 at night: lights up windows. */
  uNight: { value: number };
}

const UNIT_VERT_HEAD = /* glsl */ `
attribute float teamMask;
attribute float pattern;
varying float vPattern;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying float vSeed;
`;

const UNIT_FRAG_HEAD = /* glsl */ `
uniform float uNight;
varying float vPattern;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying float vSeed;
float unitHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

// Surface detail in model space, so it scales with the model. Fades out
// when the pattern would be smaller than a pixel (no shimmering).
const UNIT_PATTERN_GLSL = /* glsl */ `
float unitWindowLight = 0.0;
if (vPattern > 0.5) {
  vec3 ln = normalize(vLocalNormal);
  float side = 1.0 - step(0.6, abs(ln.y));
  float u = abs(ln.x) > abs(ln.z) ? vLocalPos.z : vLocalPos.x;
  // Soft contact shadow at the foot of walls.
  diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.35, vLocalPos.y));
  if (vPattern < 1.5) {
    vec2 g = vec2(u * 6.0, vLocalPos.y * 5.0);
    vec2 f = fract(g);
    float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.8);
    float lod = 1.0 - smoothstep(0.3, 0.7, max(fwidth(g.x), fwidth(g.y)));
    win *= side * lod * step(0.18, vLocalPos.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.05, 0.08), win * 0.8);
    float lit = step(0.42, unitHash(floor(g) + vSeed));
    unitWindowLight = win * lit;
  } else if (vPattern < 2.5) {
    // Ribbed metal: seams on walls, ridges on roofs.
    float w = side > 0.5 ? u : vLocalPos.x + vLocalPos.z;
    float rib = fract(w * 5.0);
    float lod = 1.0 - smoothstep(0.3, 0.7, fwidth(w * 5.0));
    diffuseColor.rgb *= 1.0 - 0.22 * lod * (smoothstep(0.8, 0.95, rib) + 0.5 * smoothstep(0.2, 0.0, rib));
  } else {
    // Brick courses with staggered joints.
    vec2 g = vec2(u * 9.0, vLocalPos.y * 18.0);
    g.x += 0.5 * mod(floor(g.y), 2.0);
    vec2 f = fract(g);
    float mortar = max(step(f.x, 0.08), step(f.y, 0.12));
    float lod = 1.0 - smoothstep(0.3, 0.7, max(fwidth(g.x), fwidth(g.y)));
    float tone = 0.9 + 0.2 * unitHash(floor(g));
    diffuseColor.rgb *= mix(1.0, tone, lod * side);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.52, 0.48), mortar * lod * side * 0.6);
  }
}
`;

export function createUnitMaterial(): {
  material: MeshStandardMaterial;
  uniforms: UnitMaterialUniforms;
} {
  const uniforms: UnitMaterialUniforms = { uNight: { value: 0 } };
  const m = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.65,
    metalness: 0.15,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + UNIT_VERT_HEAD)
      .replace(
        "#include <color_vertex>",
        `vColor = vec4(mix(color.rgb, instanceColor.rgb, teamMask), 1.0);
vPattern = pattern;
vLocalPos = position;
vLocalNormal = normal;
vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.71;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + UNIT_FRAG_HEAD)
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" + UNIT_PATTERN_GLSL,
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * unitWindowLight * uNight * 1.8;",
      );
  };
  m.customProgramCacheKey = () => "laukolaroser-unit-v3";
  return { material: m, uniforms };
}

/** Enemy submarines are visible within this many tiles of your ships/ports. */
const SUB_SIGHT_RANGE = 30;

/** Camera distance beyond which trade ships are not drawn (clutter). */
const TRADE_HIDE_DISTANCE = 700;

export class UnitRenderer {
  readonly group = new Group();
  private readonly materialSet = createUnitMaterial();
  private readonly material = this.materialSet.material;
  private readonly pools = new Map<ModelKind, InstancedPool>();
  private movers: Mover[] = [];
  /** Where each ballistic unit was first seen (its launch point). */
  private readonly origins = new Map<number, { x: number; y: number }>();
  private readonly headings = new Map<number, number>();
  /** Pose state per moving unit: displayed yaw and roll. */
  private readonly poses = new Map<number, { yaw: number; roll: number }>();
  /** When each structure appeared or was finished (for the rise). */
  private readonly structSeen = new Map<
    number,
    { at: number; building: boolean }
  >();
  private rising: Rising[] = [];
  /** Shells dropped by a bomber: they fall from its altitude. */
  private readonly bombs = new Set<number>();
  /** Moving surface ships this frame (for wakes). */
  readonly wakes: { x: number; z: number; yaw: number; scale: number }[] = [];
  /** Icon badge above every building (always readable, any zoom). */
  private readonly markers = new StructureMarkers();
  private lastAnimMs = 0;
  private readonly airHeight = new Map<number, number>();
  private tickAt = 0;
  private tickIntervalMs = 100;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, "YZX");
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();

  constructor(
    private readonly hf: Heightfield,
    private readonly mapWidth: number,
  ) {
    this.group.name = "units";
    this.group.add(this.markers.mesh);
    for (const kind of ALL_MODEL_KINDS) {
      this.pools.set(
        kind,
        new InstancedPool(
          modelGeometry(kind),
          this.material,
          this.group,
          16,
          !BALLISTIC_KINDS.has(kind),
        ),
      );
    }
  }

  /**
   * Per simulation tick. Rebuilds the instance lists; structures are placed
   * here once, movers are animated by `animate` every frame.
   */
  update(
    units: ReadonlyMap<number, UnitInput>,
    palette: Float32Array,
    nowMs: number,
    cameraDistance: number,
    mySmallID: number | null = null,
    visible: ((u: UnitInput) => boolean) | null = null,
  ): void {
    const hiddenSubs = hiddenSubmarines(
      units.values(),
      mySmallID,
      this.mapWidth,
      SUB_SIGHT_RANGE,
    );
    if (this.tickAt > 0) {
      const dt = nowMs - this.tickAt;
      if (dt > 20 && dt < 1000)
        this.tickIntervalMs += (dt - this.tickIntervalMs) * 0.2;
    }
    this.tickAt = nowMs;

    for (const pool of this.pools.values()) pool.begin();
    this.markers.begin();
    const movers: Mover[] = [];
    const rising: Rising[] = [];
    const seen = new Set<number>();
    const structsNow = new Set<number>();
    const w = this.mapWidth;
    // Buildings grow only a little when zoomed out (the icon badges keep
    // them readable), so they never cover the map.
    const structScale = zoomScale(cameraDistance, 110, 2.2);
    const metro = metroFactors(units.values(), w);
    const bomberTiles: { x: number; y: number }[] = [];
    for (const u of units.values()) {
      if (u.isActive && u.unitType === "Bomber") {
        bomberTiles.push({ x: u.pos % w, y: Math.floor(u.pos / w) });
      }
    }

    for (const u of units.values()) {
      if (!u.isActive || u.waitTicks > 0) continue;
      if (hiddenSubs.has(u.id)) continue;
      if (visible !== null && !visible(u)) continue;
      const kind = modelKindFor(u);
      if (kind === null) continue;
      const pool = this.pools.get(kind)!;
      this.ownerColor(palette, u.ownerID);

      const x = (u.pos % w) + 0.5;
      const y = Math.floor(u.pos / w) + 0.5;

      if (STRUCTURE_KINDS.has(kind)) {
        if (u.underConstruction) this.c.lerp(CONSTRUCTION_GREY, 0.6);
        const h = Math.max(0, this.hf.sample(x, y));
        // Higher levels and nearby cities of the same owner (a metropolis)
        // make bigger models.
        const lvl =
          (1 + 0.14 * Math.min(Math.max(u.level, 1) - 1, 10)) *
          (metro.get(u.id) ?? 1);
        const built = u.underConstruction ? 0.4 : 1;
        const yaw = ((tileHash(u.pos) & 3) * Math.PI) / 2;
        this.e.set(0, yaw, 0);
        this.q.setFromEuler(this.e);
        // Rise from the ground when placed and again when finished.
        structsNow.add(u.id);
        let st = this.structSeen.get(u.id);
        if (st === undefined) {
          st = { at: nowMs, building: u.underConstruction };
          this.structSeen.set(u.id, st);
        } else if (st.building && !u.underConstruction) {
          st.at = nowMs;
          st.building = false;
        }
        const age = nowMs - st.at;
        const sxz = structScale * lvl;
        const sy = structScale * lvl * built;
        this.p.set(x, h, y);
        this.s.set(sxz, sy * buildRise(age), sxz);
        this.m.compose(this.p, this.q, this.s);
        const slot = pool.push(this.m, this.c);
        this.markers.push(kind, x, h + 1.2 * sy, y, this.c);
        if (age < BUILD_RISE_MS) {
          rising.push({ kind, slot, at: st.at, x, h, y, yaw, sxz, sy });
        }
        continue;
      }

      seen.add(u.id);
      const mover: Mover = {
        id: u.id,
        kind,
        x0: (u.lastPos % w) + 0.5,
        y0: Math.floor(u.lastPos / w) + 0.5,
        x1: x,
        y1: y,
        ox: NaN,
        oy: NaN,
        tx: NaN,
        ty: NaN,
        targetUnitId: u.targetUnitId,
        slot: 0,
      };
      const ballistic = BALLISTIC_KINDS.has(kind) && u.targetTile !== null;
      if (ballistic || AIR_KINDS.has(kind)) {
        let o = this.origins.get(u.id);
        if (o === undefined) {
          o = { x: mover.x0, y: mover.y0 };
          this.origins.set(u.id, o);
          // A shell born under a bomber is a bomb.
          if (kind === "artilleryShell") {
            for (const b of bomberTiles) {
              const ex = b.x - o.x;
              const ey = b.y - o.y;
              if (ex * ex + ey * ey <= 16) {
                this.bombs.add(u.id);
                break;
              }
            }
          }
        }
        mover.ox = o.x;
        mover.oy = o.y;
      }
      if (ballistic && u.targetTile !== null) {
        mover.tx = (u.targetTile % w) + 0.5;
        mover.ty = Math.floor(u.targetTile / w) + 0.5;
      }
      // Placeholder matrix; animate() writes the real one this frame.
      mover.slot = pool.push(this.m, this.c);
      movers.push(mover);
    }

    for (const id of this.origins.keys())
      if (!seen.has(id)) this.origins.delete(id);
    for (const id of this.bombs) if (!seen.has(id)) this.bombs.delete(id);
    for (const id of this.headings.keys())
      if (!seen.has(id)) this.headings.delete(id);
    for (const id of this.poses.keys())
      if (!seen.has(id)) this.poses.delete(id);
    for (const id of this.structSeen.keys())
      if (!structsNow.has(id)) this.structSeen.delete(id);
    this.movers = movers;
    this.rising = rising;
    this.markers.end();
    for (const pool of this.pools.values()) pool.end(true);
  }

  /** Per render frame: interpolate and pose every moving unit. */
  animate(nowMs: number, cameraDistance: number): void {
    const dt =
      this.lastAnimMs > 0
        ? Math.min(0.1, Math.max(0, (nowMs - this.lastAnimMs) / 1000))
        : 0;
    this.lastAnimMs = nowMs;
    // Zoomed out: buildings are flat 2D icons (easy to see and stack);
    // zoomed in: 3D models with small badges.
    this.iconMode =
      this.iconModeAllowed && nextIconMode(this.iconMode, cameraDistance);
    for (const kind of STRUCTURE_KINDS) {
      const pool = this.pools.get(kind);
      if (pool) pool.mesh.visible = !this.iconMode;
    }
    this.markers.setView(
      cameraDistance,
      this.showMarkers || this.iconMode,
      this.iconMode,
    );
    this.animateRising(nowMs);
    if (this.movers.length === 0) return;
    const alpha = Math.min(1, (nowMs - this.tickAt) / this.tickIntervalMs);
    const t = nowMs / 1000;
    // Units grow a little when zoomed out so they stay visible, but never
    // so much that they cover the map. Trade ships are the most numerous:
    // smaller still, and hidden when the whole map is in view.
    const shipScale = zoomScale(cameraDistance, 120, 5);
    const tradeScale =
      cameraDistance > TRADE_HIDE_DISTANCE
        ? 0
        : zoomScale(cameraDistance, 160, 3.5);
    const airScale = zoomScale(cameraDistance, 90, 7);
    this.airHeight.clear();

    this.wakes.length = 0;
    // Ballistic first, so SAM missiles can read their target's altitude.
    for (let pass = 0; pass < 2; pass++) {
      for (const mv of this.movers) {
        const ballistic = BALLISTIC_KINDS.has(mv.kind);
        if ((pass === 0) !== ballistic) continue;
        const x = mv.x0 + (mv.x1 - mv.x0) * alpha;
        const y = mv.y0 + (mv.y1 - mv.y0) * alpha;
        let targetYaw = this.headings.get(mv.id) ?? 0;
        const dx = mv.x1 - mv.x0;
        const dy = mv.y1 - mv.y0;
        if (dx * dx + dy * dy > 1e-6) {
          targetYaw = Math.atan2(-dy, dx);
          this.headings.set(mv.id, targetYaw);
        }
        // Vehicles turn at a limited rate and lean into the turn;
        // missiles and shells point straight along their path.
        let yaw = targetYaw;
        let lean = 0;
        if (!ballistic && mv.kind !== "samMissile") {
          let pose = this.poses.get(mv.id);
          if (pose === undefined) {
            pose = { yaw: targetYaw, roll: 0 };
            this.poses.set(mv.id, pose);
          }
          const before = pose.yaw;
          pose.yaw = turnToward(pose.yaw, targetYaw, turnRate(mv.kind) * dt);
          const rate = dt > 0 ? wrapAngle(pose.yaw - before) / dt : 0;
          const air = AIR_KINDS.has(mv.kind);
          pose.roll = smoothTo(
            pose.roll,
            TRAIN_KINDS.has(mv.kind) ? 0 : bankFor(air, rate),
            dt,
            air ? 0.35 : 0.6,
          );
          yaw = pose.yaw;
          lean = pose.roll;
        }
        let h = 0;
        let pitch = 0;
        let roll = lean;
        let scale = mv.kind === "tradeShip" ? tradeScale : shipScale;

        if (SHIP_KINDS.has(mv.kind)) {
          const phase = mv.id * 1.7;
          h =
            (mv.kind === "submarine" ? -0.12 : 0.02) +
            Math.sin(t * 1.6 + phase) * 0.04;
          // Swell: heavy ships roll less.
          const heavy =
            mv.kind === "battleship" || mv.kind === "carrier" ? 0.5 : 1;
          roll += Math.sin(t * 1.1 + phase) * 0.05 * heavy;
          pitch = Math.sin(t * 1.3 + phase * 0.7) * 0.025 * heavy;
          // Bow lifts a little under way, and leaves a wake.
          if (dx * dx + dy * dy > 1e-6) {
            pitch += 0.03;
            if (mv.kind !== "submarine" && scale > 0) {
              this.wakes.push({ x, z: y, yaw, scale });
            }
          }
        } else if (AIR_KINDS.has(mv.kind)) {
          scale = airScale * (mv.kind === "bomber" ? 1.4 : 1);
          const cruise = mv.kind === "bomber" ? 9 : 11;
          const fromBase = Number.isFinite(mv.ox)
            ? Math.hypot(x - mv.ox, y - mv.oy)
            : 99;
          h = Math.max(0, this.hf.sample(x, y)) + airAltitude(fromBase, cruise);
          // Outbound when moving away from base.
          const away =
            (mv.x1 - mv.ox) * (mv.x1 - mv.ox) +
              (mv.y1 - mv.oy) * (mv.y1 - mv.oy) >=
            (mv.x0 - mv.ox) * (mv.x0 - mv.ox) +
              (mv.y0 - mv.oy) * (mv.y0 - mv.oy);
          pitch = airClimbPitch(fromBase, cruise, away);
          roll += Math.sin(t * 0.9 + mv.id) * 0.03;
        } else if (TRAIN_KINDS.has(mv.kind)) {
          h = Math.max(0, this.hf.sample(x, y));
          scale = zoomScale(cameraDistance, 130, 4);
        } else if (ballistic) {
          scale = airScale;
          if (this.bombs.has(mv.id) && Number.isFinite(mv.ox)) {
            // Free fall from the bomber's height: carries its forward
            // speed, accelerates down, noses over.
            const f = flightProgress(mv.ox, mv.oy, x, y, mv.tx, mv.ty);
            const ground = Math.max(0, this.hf.sample(x, y));
            const p = f.progress;
            h = ground + 0.3 + (9 - 0.3) * (1 - p * p);
            pitch = -Math.atan(2 * p * 1.5);
          } else if (Number.isFinite(mv.ox)) {
            const f = flightProgress(mv.ox, mv.oy, x, y, mv.tx, mv.ty);
            const peak = arcPeak(mv.kind, f.distance);
            const arc = arcAt(peak, f.distance, f.progress);
            const ground = Math.max(0, this.hf.sample(x, y));
            h = ground + arc.height + 0.5;
            pitch = Math.atan(arc.slope);
          } else {
            h = 12;
          }
          this.airHeight.set(mv.id, h);
        } else if (mv.kind === "samMissile") {
          scale = airScale;
          const target =
            mv.targetUnitId !== null
              ? this.airHeight.get(mv.targetUnitId)
              : undefined;
          const ground = Math.max(0, this.hf.sample(x, y));
          h =
            target !== undefined
              ? ground + (target - ground) * 0.85
              : ground + 8;
          pitch = 0.6;
        }

        this.e.set(roll, yaw, pitch);
        this.q.setFromEuler(this.e);
        this.p.set(x, h, y);
        this.s.setScalar(scale);
        this.m.compose(this.p, this.q, this.s);
        this.pools.get(mv.kind)!.setMatrix(mv.slot, this.m);
      }
    }
    for (const mv of this.movers) this.pools.get(mv.kind)!.touchMatrices();
  }

  /** Pose buildings that are still rising out of the ground. */
  private animateRising(nowMs: number): void {
    if (this.rising.length === 0) return;
    let live = 0;
    for (const r of this.rising) {
      const age = nowMs - r.at;
      this.e.set(0, r.yaw, 0);
      this.q.setFromEuler(this.e);
      this.p.set(r.x, r.h, r.y);
      this.s.set(r.sxz, r.sy * buildRise(age), r.sxz);
      this.m.compose(this.p, this.q, this.s);
      const pool = this.pools.get(r.kind)!;
      pool.setMatrix(r.slot, this.m);
      pool.touchMatrices();
      if (age < BUILD_RISE_MS) this.rising[live++] = r;
    }
    this.rising.length = live;
  }

  private showMarkers = true;
  /** Buildings drawn as 2D icons (camera far out). */
  private iconMode = false;
  /** Player setting: 2D icons when zoomed out (else always 3D). */
  private iconModeAllowed = true;

  setIconModeAllowed(allowed: boolean): void {
    this.iconModeAllowed = allowed;
  }

  /** Per frame, after the camera moved: place and group the icons. */
  layoutMarkers(camera: Camera, width: number, height: number): void {
    this.markers.layout(camera, width, height);
  }

  /** True while buildings are shown as flat 2D icons. */
  isIconMode(): boolean {
    return this.iconMode;
  }

  /** Show or hide the icon badges above buildings. */
  setMarkersVisible(visible: boolean): void {
    this.showMarkers = visible;
  }

  /** 0 by day … 1 at night (lit windows). */
  setNight(night: number): void {
    this.materialSet.uniforms.uNight.value = night;
  }

  /** Number of moving units currently animated. */
  moverCount(): number {
    return this.movers.length;
  }

  dispose(): void {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.markers.dispose();
    this.material.dispose();
  }

  private ownerColor(palette: Float32Array, smallID: number): void {
    const o = smallID * 4;
    if (o + 2 < palette.length && palette[o + 3] > 0) {
      this.c.setRGB(palette[o], palette[o + 1], palette[o + 2], SRGBColorSpace);
    } else {
      this.c.setRGB(0.6, 0.6, 0.6, SRGBColorSpace);
    }
  }
}

/** Cities closer than this (tiles) to another of the same owner merge. */
const METRO_RADIUS = 5;

/**
 * Size factor per city: each other city of the same owner within
 * METRO_RADIUS adds 15% (max +60%), so clusters read as one metropolis.
 */
export function metroFactors(
  units: Iterable<{
    id: number;
    unitType: string;
    ownerID: number;
    pos: number;
    isActive: boolean;
  }>,
  mapWidth: number,
): Map<number, number> {
  const cities: { id: number; owner: number; x: number; y: number }[] = [];
  for (const u of units) {
    if (!u.isActive || u.unitType !== "City") continue;
    cities.push({
      id: u.id,
      owner: u.ownerID,
      x: u.pos % mapWidth,
      y: Math.floor(u.pos / mapWidth),
    });
  }
  const out = new Map<number, number>();
  if (cities.length < 2) return out;
  // Spatial hash by METRO_RADIUS cells.
  const grid = new Map<string, typeof cities>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const c of cities) {
    const k = key(
      Math.floor(c.x / METRO_RADIUS),
      Math.floor(c.y / METRO_RADIUS),
    );
    const list = grid.get(k);
    if (list) list.push(c);
    else grid.set(k, [c]);
  }
  const r2 = METRO_RADIUS * METRO_RADIUS;
  for (const c of cities) {
    const cx = Math.floor(c.x / METRO_RADIUS);
    const cy = Math.floor(c.y / METRO_RADIUS);
    let n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        for (const o of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (o === c || o.owner !== c.owner) continue;
          const ex = o.x - c.x;
          const ey = o.y - c.y;
          if (ex * ex + ey * ey <= r2) n++;
        }
      }
    if (n > 0) out.set(c.id, 1 + 0.15 * Math.min(n, 4));
  }
  return out;
}
