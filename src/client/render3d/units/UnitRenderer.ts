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
  arcAt,
  arcPeak,
  BALLISTIC_KINDS,
  flightProgress,
  modelKindFor,
  SHIP_KINDS,
  STRUCTURE_KINDS,
  tileHash,
  TRAIN_KINDS,
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

export function createUnitMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.65,
    metalness: 0.15,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float teamMask;",
      )
      .replace(
        "#include <color_vertex>",
        "vColor = vec4(mix(color.rgb, instanceColor.rgb, teamMask), 1.0);",
      );
  };
  m.customProgramCacheKey = () => "laukolaroser-unit-v2";
  return m;
}

export class UnitRenderer {
  readonly group = new Group();
  private readonly material = createUnitMaterial();
  private readonly pools = new Map<ModelKind, InstancedPool>();
  private movers: Mover[] = [];
  /** Where each ballistic unit was first seen (its launch point). */
  private readonly origins = new Map<number, { x: number; y: number }>();
  private readonly headings = new Map<number, number>();
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
  ): void {
    if (this.tickAt > 0) {
      const dt = nowMs - this.tickAt;
      if (dt > 20 && dt < 1000)
        this.tickIntervalMs += (dt - this.tickIntervalMs) * 0.2;
    }
    this.tickAt = nowMs;

    for (const pool of this.pools.values()) pool.begin();
    const movers: Mover[] = [];
    const seen = new Set<number>();
    const w = this.mapWidth;
    const structScale = zoomScale(cameraDistance, 80, 8);

    for (const u of units.values()) {
      if (!u.isActive || u.waitTicks > 0) continue;
      const kind = modelKindFor(u);
      if (kind === null) continue;
      const pool = this.pools.get(kind)!;
      this.ownerColor(palette, u.ownerID);

      const x = (u.pos % w) + 0.5;
      const y = Math.floor(u.pos / w) + 0.5;

      if (STRUCTURE_KINDS.has(kind)) {
        if (u.underConstruction) this.c.lerp(CONSTRUCTION_GREY, 0.6);
        const h = Math.max(0, this.hf.sample(x, y));
        const lvl = 1 + 0.14 * Math.min(Math.max(u.level, 1) - 1, 10);
        const built = u.underConstruction ? 0.4 : 1;
        const yaw = ((tileHash(u.pos) & 3) * Math.PI) / 2;
        this.e.set(0, yaw, 0);
        this.q.setFromEuler(this.e);
        this.p.set(x, h, y);
        this.s.set(
          structScale * lvl,
          structScale * lvl * built,
          structScale * lvl,
        );
        this.m.compose(this.p, this.q, this.s);
        pool.push(this.m, this.c);
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
      if (BALLISTIC_KINDS.has(kind) && u.targetTile !== null) {
        let o = this.origins.get(u.id);
        if (o === undefined) {
          o = { x: mover.x0, y: mover.y0 };
          this.origins.set(u.id, o);
        }
        mover.ox = o.x;
        mover.oy = o.y;
        mover.tx = (u.targetTile % w) + 0.5;
        mover.ty = Math.floor(u.targetTile / w) + 0.5;
      }
      // Placeholder matrix; animate() writes the real one this frame.
      mover.slot = pool.push(this.m, this.c);
      movers.push(mover);
    }

    for (const id of this.origins.keys())
      if (!seen.has(id)) this.origins.delete(id);
    for (const id of this.headings.keys())
      if (!seen.has(id)) this.headings.delete(id);
    this.movers = movers;
    for (const pool of this.pools.values()) pool.end(true);
  }

  /** Per render frame: interpolate and pose every moving unit. */
  animate(nowMs: number, cameraDistance: number): void {
    if (this.movers.length === 0) return;
    const alpha = Math.min(1, (nowMs - this.tickAt) / this.tickIntervalMs);
    const t = nowMs / 1000;
    const shipScale = zoomScale(cameraDistance, 70, 16);
    const airScale = zoomScale(cameraDistance, 60, 14);
    this.airHeight.clear();

    // Ballistic first, so SAM missiles can read their target's altitude.
    for (let pass = 0; pass < 2; pass++) {
      for (const mv of this.movers) {
        const ballistic = BALLISTIC_KINDS.has(mv.kind);
        if ((pass === 0) !== ballistic) continue;
        const x = mv.x0 + (mv.x1 - mv.x0) * alpha;
        const y = mv.y0 + (mv.y1 - mv.y0) * alpha;
        let yaw = this.headings.get(mv.id) ?? 0;
        const dx = mv.x1 - mv.x0;
        const dy = mv.y1 - mv.y0;
        if (dx * dx + dy * dy > 1e-6) {
          yaw = Math.atan2(-dy, dx);
          this.headings.set(mv.id, yaw);
        }
        let h = 0;
        let pitch = 0;
        let roll = 0;
        let scale = shipScale;

        if (SHIP_KINDS.has(mv.kind)) {
          const phase = mv.id * 1.7;
          h = 0.02 + Math.sin(t * 1.6 + phase) * 0.04;
          roll = Math.sin(t * 1.1 + phase) * 0.05;
          pitch = Math.sin(t * 1.3 + phase * 0.7) * 0.025;
        } else if (TRAIN_KINDS.has(mv.kind)) {
          h = Math.max(0, this.hf.sample(x, y));
          scale = zoomScale(cameraDistance, 90, 8);
        } else if (ballistic) {
          scale = airScale;
          if (Number.isFinite(mv.ox)) {
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

  /** Number of moving units currently animated. */
  moverCount(): number {
    return this.movers.length;
  }

  dispose(): void {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
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
