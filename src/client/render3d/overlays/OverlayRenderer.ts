/**
 * OverlayRenderer — interactive previews in 3D:
 *   - build ghost: a translucent model of the structure being placed
 *     (green = can build, red = cannot), with its range ring,
 *   - nuke trajectory: the planned flight as a 3D arc, white where SAMs
 *     can hit it, amber where it is out of reach, red past the first SAM
 *     intercept, plus a target ring,
 *   - weapon aim: a pulsing blast-radius reticle under the cursor, green
 *     when a ready launcher is in range, red when not.
 *
 * Fed by the same controller calls that drive the 2D renderer
 * (MapRenderer.updateGhostPreview / updateNukeTrajectory).
 */

import {
  BufferAttribute,
  Color,
  CubicBezierCurve3,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import type { GhostPreviewData, NukeTrajectoryData } from "../../render/types";
import type { Heightfield } from "../terrain/Heightfield";
import {
  arcAt,
  arcPeak,
  modelKindFor,
  STRUCTURE_KINDS,
  zoomScale,
} from "../units/UnitKinds";
import { modelGeometry } from "../units/UnitModels";

const OK = new Color(0x4ade80);
const BAD = new Color(0xf87171);
const BLOCKED = new Color(0xfbbf24);
/** Warning ring colour per disaster kind. */
const DISASTER_COLORS: Record<string, number> = {
  volcano: 0xff5a1f,
  earthquake: 0xd4a373,
  tsunami: 0x38bdf8,
  storm: 0xa5b4fc,
  wildfire: 0xf97316,
};
const SAFE = new Color(0xf5f5f5);
const OUT_OF_REACH = new Color(0xfbbf24);
const INTERCEPT = new Color(0xef4444);

export interface WeaponAim {
  /** Continuous tile coordinates of the aim point. */
  x: number;
  y: number;
  /** Blast radius, tiles. */
  radius: number;
  /** A ready launcher can reach this point. */
  inRange: boolean;
  /** In range, but mountains block every shot (amber reticle). */
  blocked?: boolean;
}

export class OverlayRenderer {
  readonly group = new Group();
  private readonly ghost: Mesh;
  private readonly ghostMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private readonly range: Mesh;
  private readonly rangeMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.7,
    depthTest: false,
    depthWrite: false,
  });
  private readonly target: Mesh;
  private trajectory: Mesh | null = null;
  private readonly trajMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  private ghostData: GhostPreviewData | null = null;
  private readonly aim: Mesh;
  private readonly aimInner: Mesh;
  private readonly aimMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  private aimData: WeaponAim | null = null;
  /** Disaster warning rings by disaster id. */
  private readonly disasters = new Map<
    number,
    { outer: Mesh; inner: Mesh; x: number; y: number; r: number; at: number }
  >();
  private readonly markerRing = (() => {
    const g = new RingGeometry(0.97, 1, 128, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  })();

  constructor(private readonly hf: Heightfield) {
    this.group.name = "overlays";
    this.group.renderOrder = 10;
    this.ghost = new Mesh(modelGeometry("city"), this.ghostMat);
    this.ghost.visible = false;
    this.ghost.renderOrder = 10;
    const ring = new RingGeometry(0.985, 1, 128, 1);
    ring.rotateX(-Math.PI / 2);
    this.range = new Mesh(ring, this.rangeMat);
    this.range.visible = false;
    this.range.renderOrder = 11;
    this.target = new Mesh(ring, this.rangeMat.clone());
    (this.target.material as MeshBasicMaterial).color.copy(INTERCEPT);
    this.target.visible = false;
    this.target.renderOrder = 11;
    this.aim = new Mesh(ring, this.aimMat);
    this.aimInner = new Mesh(ring, this.aimMat);
    this.aim.visible = false;
    this.aimInner.visible = false;
    this.aim.renderOrder = 12;
    this.aimInner.renderOrder = 12;
    this.group.add(
      this.ghost,
      this.range,
      this.target,
      this.aim,
      this.aimInner,
    );
  }

  /** Weapon aiming reticle; null hides it. */
  setAim(aim: WeaponAim | null): void {
    this.aimData = aim;
    const on = aim !== null;
    this.aim.visible = on;
    this.aimInner.visible = on;
    if (aim) {
      this.aimMat.color.copy(aim.inRange ? OK : aim.blocked ? BLOCKED : BAD);
    }
  }

  setGhost(data: GhostPreviewData | null): void {
    this.ghostData = data;
    if (data === null) {
      this.ghost.visible = false;
      this.range.visible = false;
      return;
    }
    const kind = modelKindFor({
      unitType: data.ghostType,
      trainType: null,
      loaded: null,
    });
    // Buildings and warships show a model; nukes show only their blast ring.
    const showModel =
      kind !== null &&
      (STRUCTURE_KINDS.has(kind) ||
        kind === "warship" ||
        kind === "destroyer" ||
        kind === "battleship");
    if (showModel) this.ghost.geometry = modelGeometry(kind);
    const ok = data.canBuild || data.canUpgrade;
    this.ghostMat.color.copy(ok ? OK : BAD);
    this.ghost.visible = showModel;
    this.range.visible = data.rangeRadius > 0;
    this.rangeMat.color.copy(data.rangeWarning ? BAD : SAFE);
  }

  setTrajectory(data: NukeTrajectoryData | null): void {
    if (this.trajectory) {
      this.group.remove(this.trajectory);
      this.trajectory.geometry.dispose();
      this.trajectory = null;
    }
    this.target.visible = false;
    if (data === null) return;

    const dist = Math.hypot(data.p3x - data.p0x, data.p3y - data.p0y);
    const peak = arcPeak("atomBomb", dist);
    // Lift the 2D bezier into 3D with the same arc the missile will fly.
    const lift = (x: number, y: number, t: number) =>
      new Vector3(
        x,
        Math.max(0, this.hf.sample(x, y)) + arcAt(peak, dist, t).height + 0.5,
        y,
      );
    const curve = new CubicBezierCurve3(
      lift(data.p0x, data.p0y, 0),
      lift(data.p1x, data.p1y, 1 / 3),
      lift(data.p2x, data.p2y, 2 / 3),
      lift(data.p3x, data.p3y, 1),
    );
    const segments = 64;
    const radial = 5;
    const radius = Math.max(0.25, dist * 0.004);
    const geom: BufferGeometry = new TubeGeometry(
      curve,
      segments,
      radius,
      radial,
      false,
    );
    const n = geom.getAttribute("position").count;
    const colors = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      if (t >= data.tSamIntercept) c.copy(INTERCEPT);
      else if (
        data.tUntargetableStart >= 0 &&
        t >= data.tUntargetableStart &&
        t <= data.tUntargetableEnd
      )
        c.copy(OUT_OF_REACH);
      else c.copy(SAFE);
      for (let j = 0; j <= radial; j++) {
        const k = (i * (radial + 1) + j) * 3;
        colors[k] = c.r;
        colors[k + 1] = c.g;
        colors[k + 2] = c.b;
      }
    }
    geom.setAttribute("color", new BufferAttribute(colors, 3));
    this.trajectory = new Mesh(geom, this.trajMat);
    this.trajectory.renderOrder = 11;
    this.trajectory.frustumCulled = false;
    this.group.add(this.trajectory);

    this.target.position.set(
      data.p3x,
      Math.max(0, this.hf.sample(data.p3x, data.p3y)) + 0.3,
      data.p3y,
    );
    this.target.scale.setScalar(Math.max(3, dist * 0.03));
    this.target.visible = true;
  }

  /**
   * Show a disaster's area (warning: a pulsing ring in the disaster's
   * colour until it is over); hideDisaster removes it.
   */
  showDisaster(
    id: number,
    kind: string,
    x: number,
    y: number,
    radius: number,
    timeSeconds: number,
  ): void {
    if (this.disasters.has(id)) return;
    const mat = new MeshBasicMaterial({
      color: DISASTER_COLORS[kind] ?? 0xfbbf24,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
    });
    const outer = new Mesh(this.markerRing, mat);
    const inner = new Mesh(this.markerRing, mat);
    outer.renderOrder = 12;
    inner.renderOrder = 12;
    this.group.add(outer, inner);
    this.disasters.set(id, { outer, inner, x, y, r: radius, at: timeSeconds });
  }

  hideDisaster(id: number): void {
    const d = this.disasters.get(id);
    if (d === undefined) return;
    this.group.remove(d.outer, d.inner);
    (d.outer.material as MeshBasicMaterial).dispose();
    this.disasters.delete(id);
  }

  /** Per frame: place the ghost (it scales with zoom like real buildings). */
  update(cameraDistance: number, timeSeconds = 0): void {
    for (const d of this.disasters.values()) {
      const h = Math.max(0, this.hf.sample(d.x, d.y)) + 0.4;
      const t = timeSeconds - d.at;
      // A steady outer ring and a wave closing in on the centre.
      d.outer.position.set(d.x, h, d.y);
      d.outer.scale.setScalar(d.r);
      d.inner.position.set(d.x, h, d.y);
      d.inner.scale.setScalar(Math.max(0.5, d.r * (1 - ((t * 0.5) % 1))));
      (d.outer.material as MeshBasicMaterial).opacity =
        0.55 + 0.35 * Math.sin(t * 5);
    }
    const a = this.aimData;
    if (a) {
      const h = Math.max(0, this.hf.sample(a.x, a.y)) + 0.3;
      const pulse = 1 + 0.08 * Math.sin(timeSeconds * 6);
      this.aim.position.set(a.x, h, a.y);
      this.aim.scale.setScalar(a.radius * pulse);
      this.aimInner.position.set(a.x, h, a.y);
      this.aimInner.scale.setScalar(Math.max(0.6, a.radius * 0.25));
    }
    const d = this.ghostData;
    if (d === null) return;
    const x = d.tileX + 0.5;
    const y = d.tileY + 0.5;
    const h = Math.max(0, this.hf.sample(x, y));
    this.ghost.position.set(x, h, y);
    this.ghost.scale.setScalar(zoomScale(cameraDistance, 80, 8));
    if (this.range.visible) {
      const rx = d.radiusTileX + 0.5;
      const ry = d.radiusTileY + 0.5;
      this.range.position.set(
        rx,
        Math.max(0, this.hf.sample(rx, ry)) + 0.3,
        ry,
      );
      this.range.scale.setScalar(d.rangeRadius);
    }
  }

  dispose(): void {
    if (this.trajectory) this.trajectory.geometry.dispose();
    this.range.geometry.dispose();
    this.ghostMat.dispose();
    this.rangeMat.dispose();
    (this.target.material as MeshBasicMaterial).dispose();
    this.trajMat.dispose();
  }
}
