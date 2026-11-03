/**
 * CameraController — strategic 3D camera driven by the existing 2D camera
 * state, plus exact screen ↔ tile projection for input.
 *
 * The game's TransformHandler stays the single owner of camera state (pan,
 * zoom, go-to-player, smoothing, clamping). This controller maps its
 * (centerX, centerY, pixelsPerTile) onto a tilted perspective camera whose
 * vertical view at the focus point spans the same number of tiles the 2D
 * view would, so zoom levels feel identical. Picking uses the real 3D
 * camera, ray-cast against the terrain height, so clicks land on the tile
 * under the cursor even on mountains.
 */

import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { Heightfield } from "../terrain/Heightfield";

export interface Camera2DState {
  /** Map tile at the centre of the viewport. */
  centerX: number;
  centerY: number;
  /** Zoom as CSS pixels per tile. */
  scale: number;
  /** Viewport size in CSS pixels. */
  viewWidth: number;
  viewHeight: number;
}

export interface CameraTuning {
  fovDeg: number;
  /** Angle between view direction and the ground (90 = top-down). */
  pitchDeg: number;
  /** Yaw around the vertical axis (0 = north up, like the 2D map). */
  yawDeg: number;
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  fovDeg: 40,
  pitchDeg: 56,
  yawDeg: 0,
};

/** Tilt limits: 12° (almost at ground level) … 89° (straight down, like the 2D map). */
export const MIN_PITCH_DEG = 12;
export const MAX_PITCH_DEG = 89;

const tmpNear = new Vector3();
const tmpFar = new Vector3();
const tmpDir = new Vector3();
const tmpProj = new Vector3();

export class CameraController {
  readonly camera: PerspectiveCamera;
  readonly focus = new Vector3();
  distance = 100;
  private viewWidth = 1;
  private viewHeight = 1;
  /** Orbit targets; the live yaw/pitch ease towards them each frame. */
  private targetYaw: number;
  private targetPitch: number;

  constructor(
    private readonly hf: Heightfield,
    private tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
  ) {
    this.camera = new PerspectiveCamera(tuning.fovDeg, 1, 0.5, 20000);
    this.tuning = { ...tuning };
    this.targetYaw = tuning.yawDeg;
    this.targetPitch = tuning.pitchDeg;
  }

  setTuning(t: Partial<CameraTuning>): void {
    this.tuning = { ...this.tuning, ...t };
    this.camera.fov = this.tuning.fovDeg;
    this.targetYaw = this.tuning.yawDeg;
    this.targetPitch = this.tuning.pitchDeg;
  }

  get yawDeg(): number {
    return this.tuning.yawDeg;
  }

  get pitchDeg(): number {
    return this.tuning.pitchDeg;
  }

  /** Orbit around the focus point (degrees, positive = counter-clockwise). */
  rotateBy(deg: number): void {
    this.targetYaw += deg;
  }

  /** Tilt (degrees, positive = steeper / more top-down). */
  tiltBy(deg: number): void {
    this.targetPitch = MathUtils.clamp(
      this.targetPitch + deg,
      MIN_PITCH_DEG,
      MAX_PITCH_DEG,
    );
  }

  /** Back to north-up at the default tilt. */
  resetView(): void {
    // Unwind to the nearest full turn so the reset takes the short way round.
    this.targetYaw = Math.round(this.tuning.yawDeg / 360) * 360;
    this.targetPitch = DEFAULT_CAMERA_TUNING.pitchDeg;
  }

  /** Ease yaw/pitch towards their targets; call once per frame. */
  step(dtMs: number): void {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / 90);
    this.tuning.yawDeg += (this.targetYaw - this.tuning.yawDeg) * k;
    this.tuning.pitchDeg += (this.targetPitch - this.tuning.pitchDeg) * k;
  }

  /**
   * A screen-space drag (CSS px) converted to a ground displacement in
   * tiles, honouring the camera's yaw and tilt, so dragging moves the map
   * under the finger whichever way the camera faces.
   */
  screenDeltaToTiles(
    dx: number,
    dy: number,
    scale: number,
  ): { x: number; y: number } {
    const yaw = MathUtils.degToRad(this.tuning.yawDeg);
    const pitch = MathUtils.degToRad(this.tuning.pitchDeg);
    const sx = dx / scale;
    const sy = dy / scale / Math.max(0.3, Math.sin(pitch));
    // Screen right = (cos yaw, -sin yaw); screen down = (sin yaw, cos yaw).
    return {
      x: sx * Math.cos(yaw) + sy * Math.sin(yaw),
      y: -sx * Math.sin(yaw) + sy * Math.cos(yaw),
    };
  }

  /** Apply a 2D camera state; call once per frame before rendering. */
  sync(s: Camera2DState): void {
    this.viewWidth = Math.max(1, s.viewWidth);
    this.viewHeight = Math.max(1, s.viewHeight);
    const fov = MathUtils.degToRad(this.tuning.fovDeg);
    const tilesTall = this.viewHeight / Math.max(1e-3, s.scale);
    this.distance = tilesTall / (2 * Math.tan(fov / 2));

    // Focus at sea level (or on land when zoomed in close, so hills don't
    // swallow the camera).
    const ground = Math.max(0, this.hf.sample(s.centerX, s.centerY));
    const focusY = this.distance < 140 ? ground : 0;
    this.focus.set(s.centerX, focusY, s.centerY);

    const pitch = MathUtils.degToRad(this.tuning.pitchDeg);
    const yaw = MathUtils.degToRad(this.tuning.yawDeg);
    const horiz = this.distance * Math.cos(pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(yaw) * horiz,
      this.focus.y + this.distance * Math.sin(pitch),
      this.focus.z + Math.cos(yaw) * horiz,
    );
    // Low angles near mountains: keep the camera above the terrain under it.
    const under = this.hf.sample(
      this.camera.position.x,
      this.camera.position.z,
    );
    const clearance = Math.max(1.5, this.distance * 0.04);
    if (this.camera.position.y < under + clearance) {
      this.camera.position.y = under + clearance;
    }
    this.camera.aspect = this.viewWidth / this.viewHeight;
    this.camera.near = Math.max(0.2, this.distance * 0.02);
    this.camera.far = this.distance * 12 + 2000;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.focus);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  /** Approximate radius of the visible ground around the focus (world units). */
  viewRadius(): number {
    const fov = MathUtils.degToRad(this.tuning.fovDeg);
    const halfH = this.distance * Math.tan(fov / 2);
    return Math.hypot(
      halfH * this.camera.aspect,
      halfH / Math.sin(MathUtils.degToRad(this.tuning.pitchDeg)),
    );
  }

  /**
   * Viewport pixel → continuous tile coordinate on the visible surface
   * (terrain, or the water surface at y = 0). Returns null when the ray
   * misses the ground (above the horizon).
   */
  screenToTile(px: number, py: number): { x: number; y: number } | null {
    const ndcX = (px / this.viewWidth) * 2 - 1;
    const ndcY = -(py / this.viewHeight) * 2 + 1;
    tmpNear.set(ndcX, ndcY, -1).unproject(this.camera);
    tmpFar.set(ndcX, ndcY, 1).unproject(this.camera);
    tmpDir.subVectors(tmpFar, tmpNear).normalize();
    if (tmpDir.y >= -1e-6) return null;

    // Fixed-point refinement: intersect the plane at the surface height
    // found by the previous estimate. Converges in a few steps for the
    // smooth heightfield.
    let h = 0;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 6; i++) {
      const t = (h - tmpNear.y) / tmpDir.y;
      x = tmpNear.x + tmpDir.x * t;
      z = tmpNear.z + tmpDir.z * t;
      const nh = Math.max(0, this.hf.sample(x, z));
      if (Math.abs(nh - h) < 1e-3) break;
      h = nh;
    }
    return { x, y: z };
  }

  /** Continuous tile coordinate → viewport pixel (on the surface). */
  tileToScreen(x: number, y: number): { x: number; y: number } {
    const h = Math.max(0, this.hf.sample(x, y));
    tmpProj.set(x, h, y).project(this.camera);
    return {
      x: ((tmpProj.x + 1) / 2) * this.viewWidth,
      y: ((1 - tmpProj.y) / 2) * this.viewHeight,
    };
  }

  /** Axis-aligned tile bounds of everything visible on the ground. */
  visibleTileBounds(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const corners: [number, number][] = [
      [0, 0],
      [this.viewWidth, 0],
      [0, this.viewHeight],
      [this.viewWidth, this.viewHeight],
    ];
    for (const [px, py] of corners) {
      const t = this.screenToTile(px, py);
      if (t === null) continue;
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x);
      maxY = Math.max(maxY, t.y);
    }
    if (minX === Infinity) {
      return { minX: 0, minY: 0, maxX: this.hf.width, maxY: this.hf.height };
    }
    return { minX, minY, maxX, maxY };
  }
}
