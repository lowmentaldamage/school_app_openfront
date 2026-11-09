/**
 * World3DView — mounts the 3D WorldRenderer into a running game.
 *
 * Responsibilities (glue only, no rendering logic):
 *   - create the full-screen 3D canvas under the HUD and input overlay,
 *   - feed it each tick from WebGLFrameBuilder's frame listener,
 *   - expose a ScreenProjector so TransformHandler (and therefore every
 *     click, hover and HUD anchor) maps pixels through the 3D camera.
 *
 * Loaded with dynamic import() from ClientGameRunner only when the 3D view
 * is enabled, so three.js stays out of the default bundle.
 */

import { renderTroops } from "@laukolaroser/engine-lib/Format";
import { weaponTier } from "@laukolaroser/engine-lib/weapons/Weapons";
import type { FogOfWar } from "../fog/FogOfWar";
import type { GhostPreviewData, NukeTrajectoryData } from "../render/types";
import type { ScreenProjector } from "../TransformHandler";
import type { Camera2DState } from "./camera/CameraController";
import { OrbitControls } from "./camera/OrbitControls";
import type { StrikeTiers } from "./effects/EffectsRenderer";
import { LabelOverlay, type LabelEntry, type LabelText } from "./LabelOverlay";
import type { BomberLinePreview, WeaponAim } from "./overlays/OverlayRenderer";
import {
  type DisasterEvent3D,
  WorldRenderer,
  type WorldFrame,
} from "./WorldRenderer";

/** The player fields labels need (implemented by the client's PlayerView). */
export interface LabelPlayer {
  id(): string;
  displayName(): string;
  troops(): number;
  smallID?(): number;
  isAlive?(): boolean;
  numTilesOwned?(): number;
  /** Weapon power tiers, packed (engine-lib/weapons/Weapons.ts). */
  weaponTiers?(): number;
}

export interface World3DViewInit {
  mapWidth: number;
  mapHeight: number;
  terrain: Uint8Array;
  /** Land height levels (0-100) when the map has them (height.bin). */
  levels?: Uint8Array | null;
  paletteSize: number;
}

export class World3DView implements ScreenProjector {
  readonly canvas: HTMLCanvasElement;
  readonly world: WorldRenderer;
  private readonly labels: LabelOverlay;
  private readonly orbit: OrbitControls;

  constructor(init: World3DViewInit) {
    const canvas = document.createElement("canvas");
    canvas.id = "world3d-canvas";
    Object.assign(canvas.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      display: "block",
    });
    document.body.insertBefore(canvas, document.body.firstChild);
    this.canvas = canvas;
    try {
      this.world = new WorldRenderer({ canvas, ...init });
    } catch (e) {
      canvas.remove();
      throw e;
    }
    this.labels = new LabelOverlay(canvas);
    this.orbit = new OrbitControls(
      this.world.cameraController,
      document.getElementById("game-input-overlay") ?? document.body,
    );
  }

  /** Build-mode ghost (mirrors MapRenderer.updateGhostPreview). */
  setGhostPreview(data: GhostPreviewData | null): void {
    this.world.overlays.setGhost(data);
  }

  /** War mood 0 (peace) - 1 (fighting for survival): dims the light. */
  setWarMood(intensity: number): void {
    this.world.setWarMood(intensity);
  }

  /** Rocket bomber run preview; null hides it. */
  setBomberLine(p: BomberLinePreview | null): void {
    this.world.overlays.setBomberLine(p);
  }

  /** Weapon aim reticle; null hides it. */
  setWeaponAim(aim: WeaponAim | null): void {
    this.world.overlays.setAim(aim);
  }

  /** Nuke flight preview (mirrors MapRenderer.updateNukeTrajectory). */
  setNukeTrajectory(data: NukeTrajectoryData | null): void {
    this.world.overlays.setTrajectory(data);
  }

  /** Country tint 0-1 (player setting). */
  setTerritoryTint(strength: number): void {
    this.world.setTerritoryTint(strength);
  }

  /** Buildings as flat 2D icons when zoomed out (player setting). */
  setFlatBuildingIcons(on: boolean): void {
    this.world.setFlatBuildingIcons(on);
  }

  /** Hovered player's borders glow (mirrors MapRenderer.setHighlightOwner). */
  setHighlightOwner(smallID: number): void {
    this.world.setHighlightOwner(smallID);
  }

  screenDeltaToTiles(
    dx: number,
    dy: number,
    scale: number,
  ): { x: number; y: number } {
    return this.world.cameraController.screenDeltaToTiles(dx, dy, scale);
  }

  /** Per simulation tick. */
  onTick(
    frame: WorldFrame & { readonly names: ReadonlyMap<string, LabelEntry> },
    palette: Float32Array,
    players: Iterable<LabelPlayer>,
    myPlayerID: string | null,
    mySmallID: number | null = null,
    fog: FogOfWar | null = null,
  ): void {
    const all = Array.from(players);
    const strikeTiers = new Map<number, StrikeTiers>();
    for (const p of all) {
      const packed = p.weaponTiers?.() ?? 0;
      if (packed !== 0 && p.smallID !== undefined) {
        strikeTiers.set(p.smallID(), {
          artillery: weaponTier(packed, "artillery"),
          naval: weaponTier(packed, "naval"),
          airstrike: weaponTier(packed, "airstrike"),
          rocket: weaponTier(packed, "rocket"),
        });
      }
    }
    // Before the frame, so this tick's impacts use the current tiers.
    this.world.setStrikeTiers(strikeTiers);
    if (fog !== null) {
      fog.updateOwners(frame.tileState, frame.changedTiles);
      fog.computeVisibility(frame.units.values());
    }
    this.world.updateFrame(
      frame,
      palette,
      performance.now(),
      mySmallID,
      fog === null ? null : (u) => fog.isUnitVisible(u),
    );
    const texts = new Map<string, LabelText>();
    for (const p of all) {
      // No land left: the name goes at once, without waiting for the
      // elimination to reach the name list.
      if (p.isAlive?.() === false || p.numTilesOwned?.() === 0) continue;
      const id = p.id();
      texts.set(id, {
        name: p.displayName(),
        troops: renderTroops(p.troops()),
        mine: id === myPlayerID,
      });
    }
    this.labels.setLabels([...frame.names.values()], texts);
  }

  /** Natural disaster events of the latest tick (markers and effects). */
  onDisasters(events: readonly DisasterEvent3D[]): void {
    if (events.length > 0) this.world.onDisasters(events);
  }

  /** Day/night and weather; call each tick with the game tick. */
  setAtmosphere(
    tick: number,
    options: { dayNight: boolean; weather: boolean },
    seed = 0,
  ): void {
    this.world.setAtmosphere(tick, options, seed);
  }

  /** Per animation frame. */
  render(camera: Camera2DState, nowMs: number): void {
    this.world.render(camera, nowMs);
    this.orbit.update();
    const cc = this.world.cameraController;
    const key = `${cc.yawDeg.toFixed(2)},${cc.pitchDeg.toFixed(2)},${camera.centerX.toFixed(2)},${camera.centerY.toFixed(2)},${camera.scale.toFixed(4)},${camera.viewWidth},${camera.viewHeight}`;
    this.labels.draw(
      (x, y) => this.world.tileToScreen(x, y),
      camera.viewWidth,
      camera.viewHeight,
      key,
      this.world.profile.mobile ? 2 : 1.5,
    );
  }

  canvasToTile(
    canvasX: number,
    canvasY: number,
  ): { x: number; y: number } | null {
    return this.world.screenToTile(canvasX, canvasY);
  }

  tileToCanvas(tileX: number, tileY: number): { x: number; y: number } {
    return this.world.tileToScreen(tileX, tileY);
  }

  visibleTileBounds(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    return this.world.cameraController.visibleTileBounds();
  }

  dispose(): void {
    this.orbit.dispose();
    this.labels.dispose();
    this.world.dispose();
    this.canvas.remove();
  }
}
