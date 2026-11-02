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

import type { ScreenProjector } from "../TransformHandler";
import type { Camera2DState } from "./camera/CameraController";
import { WorldRenderer, type TerritoryFrame } from "./WorldRenderer";

export interface World3DViewInit {
  mapWidth: number;
  mapHeight: number;
  terrain: Uint8Array;
  paletteSize: number;
}

export class World3DView implements ScreenProjector {
  readonly canvas: HTMLCanvasElement;
  readonly world: WorldRenderer;

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
  }

  onTick(frame: TerritoryFrame, palette: Float32Array): void {
    this.world.updatePalette(palette);
    this.world.updateTerritory(frame);
  }

  render(camera: Camera2DState, nowMs: number): void {
    this.world.render(camera, nowMs);
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
    this.world.dispose();
    this.canvas.remove();
  }
}
