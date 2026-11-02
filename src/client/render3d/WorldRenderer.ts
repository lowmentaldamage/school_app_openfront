/**
 * WorldRenderer — the 3D battlefield renderer.
 *
 * A pure consumer of simulation output: it is fed the per-tick FrameData
 * (tile ownership deltas) and the player palette, and per-frame camera
 * state. It never reads or writes authoritative game state.
 *
 *   FrameData ──► TerritoryTextures ─┐
 *   terrain bytes ─► Heightfield ─► TerrainRenderer (chunked LOD)
 *                               └─► WaterRenderer
 *   Camera2DState ─► CameraController ─► EnvironmentRenderer (shadow fit)
 */

import {
  Clock,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { AdaptiveQuality } from "./AdaptiveQuality";
import {
  CameraController,
  type Camera2DState,
} from "./camera/CameraController";
import { EnvironmentRenderer } from "./environment/EnvironmentRenderer";
import { WaterRenderer } from "./environment/WaterRenderer";
import { Heightfield } from "./terrain/Heightfield";
import {
  createTerrainMaterial,
  type TerrainMaterialUniforms,
} from "./terrain/TerrainMaterial";
import { baseStrideFor, TerrainRenderer } from "./terrain/TerrainRenderer";
import { TerritoryTextures } from "./territory/TerritoryTextures";

export interface WorldRendererInit {
  canvas: HTMLCanvasElement;
  mapWidth: number;
  mapHeight: number;
  /** Per-tile terrain bytes (GameMap.terrainByte), row-major. */
  terrain: Uint8Array;
  /** Number of palette slots (smallIDs) — PlayerPalette.PALETTE_SIZE. */
  paletteSize: number;
}

export interface TerritoryFrame {
  readonly tileState: Uint16Array;
  readonly changedTiles: readonly number[] | null;
}

export class WorldRenderer {
  readonly scene = new Scene();
  readonly heightfield: Heightfield;
  readonly cameraController: CameraController;
  private readonly renderer: WebGLRenderer;
  private readonly territory: TerritoryTextures;
  private readonly terrain: TerrainRenderer;
  private readonly water: WaterRenderer;
  private readonly environment: EnvironmentRenderer;
  private readonly terrainUniforms: TerrainMaterialUniforms;
  private readonly quality = new AdaptiveQuality();
  private readonly clock = new Clock();
  private lastFrameMs = 0;
  private cssWidth = 1;
  private cssHeight = 1;
  private disposed = false;

  constructor(init: WorldRendererInit) {
    this.renderer = new WebGLRenderer({
      canvas: init.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.heightfield = Heightfield.fromTerrain(
      init.terrain,
      init.mapWidth,
      init.mapHeight,
    );
    this.territory = new TerritoryTextures(
      init.mapWidth,
      init.mapHeight,
      init.paletteSize,
    );
    const { material, uniforms } = createTerrainMaterial(
      this.territory.ownerTexture,
      this.territory.paletteTexture,
      init.mapWidth,
      init.mapHeight,
    );
    this.terrainUniforms = uniforms;
    this.terrain = new TerrainRenderer(this.heightfield, material, {
      chunkSize: 128,
      baseStride: baseStrideFor(init.mapWidth, init.mapHeight),
      lodMultipliers: [1, 2, 4],
      lodDistances: [0, 3, 7],
      skirtDepth: 2,
    });
    this.scene.add(this.terrain.group);

    this.water = new WaterRenderer(this.heightfield);
    this.scene.add(this.water.mesh);

    this.environment = new EnvironmentRenderer(this.scene, this.quality.level);
    this.cameraController = new CameraController(this.heightfield);
    this.applyQuality();
  }

  /** Per simulation tick: sync territory ownership. */
  updateTerritory(frame: TerritoryFrame): void {
    this.territory.updateOwners(frame.tileState, frame.changedTiles);
  }

  /** Sync player colours (same Float32Array the 2D renderer uses). */
  updatePalette(palette: Float32Array): void {
    this.territory.updatePalette(palette);
  }

  /** Brighten the borders of one player (e.g. hover); -1 clears. */
  setHighlightOwner(smallID: number): void {
    this.terrainUniforms.uHighlightOwner.value = smallID;
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);
  }

  /** Per animation frame. */
  render(camera: Camera2DState, nowMs: number): void {
    if (this.disposed) return;
    if (
      camera.viewWidth !== this.cssWidth ||
      camera.viewHeight !== this.cssHeight
    ) {
      this.resize(camera.viewWidth, camera.viewHeight);
    }
    if (this.lastFrameMs > 0 && this.quality.sample(nowMs - this.lastFrameMs)) {
      this.applyQuality();
    }
    this.lastFrameMs = nowMs;

    const t = this.clock.getElapsedTime();
    this.terrainUniforms.uTime.value = t;
    this.water.update(t);

    const cc = this.cameraController;
    cc.sync(camera);
    this.environment.update(cc.focus, cc.viewRadius(), cc.distance);
    this.renderer.render(this.scene, cc.camera);
  }

  screenToTile(px: number, py: number): { x: number; y: number } | null {
    return this.cameraController.screenToTile(px, py);
  }

  tileToScreen(x: number, y: number): { x: number; y: number } {
    return this.cameraController.tileToScreen(x, y);
  }

  qualityName(): string {
    return this.quality.level.name;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terrain.dispose();
    this.water.dispose();
    this.environment.dispose();
    this.territory.dispose();
    this.renderer.dispose();
  }

  private applyQuality(): void {
    const q = this.quality.level;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(dpr, q.pixelRatioCap));
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);
    if (this.renderer.shadowMap.enabled !== q.shadows) {
      this.renderer.shadowMap.enabled = q.shadows;
      // Shadow support is compiled into each program; force a rebuild.
      this.scene.traverse((o) => {
        const m = (o as { material?: { needsUpdate: boolean } }).material;
        if (m) m.needsUpdate = true;
      });
    }
    this.environment.setQuality(q);
  }
}
