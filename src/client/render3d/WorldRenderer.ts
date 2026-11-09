/**
 * WorldRenderer — the 3D battlefield renderer.
 *
 * A pure consumer of simulation output: it is fed the per-tick FrameData
 * (tile ownership deltas) and the player palette, and per-frame camera
 * state. It never reads or writes authoritative game state.
 *
 *   FrameData ─┬─► TerritoryTextures (owners, rails, fallout) ─┐
 *              ├─► UnitRenderer (ships, trains, missiles, buildings)
 *              └─► EffectsRenderer (explosions from dead-unit events)
 *   terrain bytes ─► Heightfield ─► TerrainRenderer (chunked LOD)
 *                               └─► WaterRenderer
 *   Camera2DState ─► CameraController ─► EnvironmentRenderer (shadow fit)
 */

import { deriveLevels } from "@laukolaroser/shared/maps/TerrainLevels";
import {
  ACESFilmicToneMapping,
  type DataTexture,
  Mesh,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { OWNER_MASK } from "../render/gl/utils/TileCodec";
import { AdaptiveQuality } from "./AdaptiveQuality";
import {
  CameraController,
  type Camera2DState,
} from "./camera/CameraController";
import { detectDeviceProfile, type DeviceProfile } from "./DeviceProfile";
import {
  EffectsRenderer,
  type DeadUnitEvent,
  type StrikeTiers,
} from "./effects/EffectsRenderer";
import { EnvironmentRenderer } from "./environment/EnvironmentRenderer";
import { ForestRenderer } from "./environment/ForestRenderer";
import { SeaLife } from "./environment/SeaLife";
import { WaterRenderer } from "./environment/WaterRenderer";
import { OverlayRenderer } from "./overlays/OverlayRenderer";
import { Heightfield } from "./terrain/Heightfield";
import {
  buildTerrainDetail,
  detailHeightfield,
  detailScaleFor,
  upscaleTerrainDetail,
} from "./terrain/TerrainDetail";
import {
  createTerrainDetailTexture,
  createTerrainMaterial,
  type TerrainMaterialUniforms,
} from "./terrain/TerrainMaterial";
import { baseStrideFor, TerrainRenderer } from "./terrain/TerrainRenderer";
import {
  CAPTURE_STAMP_MS,
  CAPTURE_STAMP_PERIOD,
} from "./territory/OwnerBuffer";
import { TerritoryTextures } from "./territory/TerritoryTextures";
import { UnitRenderer, type UnitInput } from "./units/UnitRenderer";

/** A natural disaster event (engine-api DisasterUpdate, the parts drawn). */
export interface DisasterEvent3D {
  id: number;
  kind: string;
  tile: number;
  radius: number;
  phase: "warning" | "strike" | "end";
}

/** On a still camera, redraw shadows every this many frames. */
const SHADOW_EVERY_FRAMES = 2;

export interface WorldRendererInit {
  canvas: HTMLCanvasElement;
  mapWidth: number;
  mapHeight: number;
  /** Per-tile terrain bytes (GameMap.terrainByte), row-major. */
  terrain: Uint8Array;
  /**
   * Land height levels (0 ground - 100 mountain tops, TerrainLevels) per tile, e.g. a custom map's
   * height.bin. Missing: derived from the terrain bytes by smoothing.
   */
  levels?: Uint8Array | null;
  /** Number of palette slots (smallIDs) — PlayerPalette.PALETTE_SIZE. */
  paletteSize: number;
  /** Device budgets; detected from the browser when omitted. */
  profile?: DeviceProfile;
  /** Keep the frame readable after render (offline previews only). */
  preserveDrawingBuffer?: boolean;
}

/** The FrameData fields the 3D world consumes each tick. */
export interface WorldFrame {
  readonly tileState: Uint16Array;
  readonly changedTiles: readonly number[] | null;
  readonly units: ReadonlyMap<number, UnitInput>;
  readonly railroadState: Uint8Array;
  readonly railroadDirty: boolean;
  readonly events: { readonly deadUnits: readonly DeadUnitEvent[] };
}

export class WorldRenderer {
  private strikeTiers: ReadonlyMap<number, StrikeTiers> = new Map();
  readonly scene = new Scene();
  readonly heightfield: Heightfield;
  private readonly terrainDetail: DataTexture;
  readonly cameraController: CameraController;
  private readonly renderer: WebGLRenderer;
  private readonly territory: TerritoryTextures;
  private readonly terrain: TerrainRenderer;
  private readonly water: WaterRenderer;
  private readonly environment: EnvironmentRenderer;
  private readonly terrainUniforms: TerrainMaterialUniforms;
  private readonly units: UnitRenderer;
  private readonly effects: EffectsRenderer;
  private readonly forests: ForestRenderer;
  private readonly seaLife: SeaLife;
  readonly overlays: OverlayRenderer;
  private firstFrame = true;
  private readonly quality: AdaptiveQuality;
  readonly profile: DeviceProfile;
  private readonly startMs = performance.now();
  private lastFrameMs = 0;
  private lastDtMs = 16;
  private cssWidth = 1;
  private cssHeight = 1;
  private disposed = false;
  private shadowFrame = 0;
  private readonly lastShadowView = new Float64Array(6);

  constructor(init: WorldRendererInit) {
    this.profile = init.profile ?? detectDeviceProfile();
    this.quality = new AdaptiveQuality(
      this.profile.initialQuality,
      undefined,
      this.profile.maxQuality,
    );
    this.renderer = new WebGLRenderer({
      canvas: init.canvas,
      antialias: this.profile.antialias,
      powerPreference: "high-performance",
      preserveDrawingBuffer: init.preserveDrawingBuffer ?? false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Shadows are redrawn when the view moves, else every other frame
    // (moving units): halves the shadow pass on a still camera.
    this.renderer.shadowMap.autoUpdate = false;

    // Heights 0-100 for the drawing (gameplay keeps the bytes' 31).
    const levels =
      init.levels && init.levels.length === init.mapWidth * init.mapHeight
        ? init.levels
        : deriveLevels(init.terrain, init.mapWidth, init.mapHeight);
    this.heightfield = Heightfield.fromTerrain(
      init.terrain,
      init.mapWidth,
      init.mapHeight,
      undefined,
      levels,
    );
    this.territory = new TerritoryTextures(
      init.mapWidth,
      init.mapHeight,
      init.paletteSize,
    );
    // Full-resolution tile data for per-pixel shading and the coastline.
    const detailHf = detailHeightfield(
      init.terrain,
      init.mapWidth,
      init.mapHeight,
      levels,
    );
    // Desktop: 2 texels per tile (smoothed coasts, finer relief); phones
    // and huge maps stay at 1. Gameplay tiles are never changed.
    const detailScale = detailScaleFor(
      init.mapWidth,
      init.mapHeight,
      this.renderer.capabilities.maxTextureSize,
      this.profile.mobile ? 0 : 9_000_000,
    );
    const detail = upscaleTerrainDetail(
      buildTerrainDetail(init.terrain, detailHf),
      detailScale,
    );
    this.terrainDetail = createTerrainDetailTexture(detail);
    // Sharp terrain at grazing angles (tilted camera).
    this.terrainDetail.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    const { material, uniforms } = createTerrainMaterial(
      this.territory.ownerTexture,
      this.territory.paletteTexture,
      this.territory.railTexture,
      this.terrainDetail,
      detail.scale,
      init.mapWidth,
      init.mapHeight,
    );
    this.terrainUniforms = uniforms;
    this.terrain = new TerrainRenderer(this.heightfield, material, {
      chunkSize: 128,
      baseStride: baseStrideFor(
        init.mapWidth,
        init.mapHeight,
        this.profile.terrainVertexBudget,
      ),
      lodMultipliers: [1, 2, 4],
      lodDistances: [0, 3, 7],
      skirtDepth: 2,
    });
    this.scene.add(this.terrain.group);

    this.water = new WaterRenderer(detailHf, this.terrainDetail);
    this.scene.add(this.water.mesh);

    this.forests = new ForestRenderer(
      init.terrain,
      this.heightfield,
      { stride: this.profile.mobile ? 5 : 3, density: 1 },
      this.profile.mobile ? 260 : 420,
      this.territory.ownerTexture,
    );
    this.scene.add(this.forests.group);

    // About one boat per 8000 tiles, so small maps aren't swamped.
    this.seaLife = new SeaLife(
      this.heightfield,
      Math.min(
        this.profile.mobile ? 60 : 160,
        Math.max(4, Math.round((init.mapWidth * init.mapHeight) / 8000)),
      ),
    );
    this.scene.add(this.seaLife.group);

    this.overlays = new OverlayRenderer(this.heightfield);
    this.scene.add(this.overlays.group);

    this.units = new UnitRenderer(this.heightfield, init.mapWidth);
    this.scene.add(this.units.group);
    this.mapWidth = init.mapWidth;
    this.effects = new EffectsRenderer(this.heightfield, init.mapWidth, {
      particles: this.profile.mobile ? 2500 : 8000,
      smoke: this.profile.mobile ? 2000 : 6000,
      lights: !this.profile.mobile,
    });
    this.effects.shake = (amount, ms) =>
      this.cameraController.shake(amount, ms);
    this.scene.add(this.effects.group);

    this.environment = new EnvironmentRenderer(
      this.scene,
      this.quality.level,
      this.profile.mobile ? 1200 : 3000,
    );
    this.cameraController = new CameraController(this.heightfield);
    this.applyQuality();
  }

  /**
   * Per simulation tick: territory, rails, units and new explosions.
   * `palette` is the same Float32Array the 2D renderer uses.
   */
  updateFrame(
    frame: WorldFrame,
    palette: Float32Array,
    nowMs: number,
    mySmallID: number | null = null,
    visible: ((u: UnitInput) => boolean) | null = null,
  ): void {
    this.territory.updatePalette(palette);
    this.territory.updateOwners(
      frame.tileState,
      frame.changedTiles,
      this.firstFrame ? null : nowMs,
    );
    if (!this.firstFrame && frame.changedTiles !== null) {
      const cc = this.cameraController;
      const state = frame.tileState;
      this.effects.battle(
        frame.changedTiles,
        (t) => (state[t] & OWNER_MASK) !== 0,
        cc.focus.x,
        cc.focus.z,
        cc.viewRadius(),
        cc.distance,
      );
    }
    if (frame.railroadDirty || this.firstFrame) {
      this.territory.updateRails(frame.railroadState);
    }
    this.firstFrame = false;
    this.units.update(
      frame.units,
      palette,
      nowMs,
      this.cameraController.distance,
      mySmallID,
      visible,
    );
    this.effects.onEvents(frame.events.deadUnits, (id) =>
      this.strikeTiers.get(id),
    );
  }

  /**
   * Day/night cycle and weather (visual only). `tick` is the game tick, so
   * every player sees the same sky; `seed` varies the weather per game.
   */
  setAtmosphere(
    tick: number,
    options: { dayNight: boolean; weather: boolean },
    seed = 0,
  ): void {
    this.environment.setOptions(options, seed);
    this.environment.setTick(tick, performance.now());
  }

  /** Current sky state, or null before the first frame. */
  atmosphereState() {
    return this.environment.state;
  }

  /** Brighten the borders of one player (e.g. hover); -1 clears. */
  private lastTimeSec = 0;
  private readonly mapWidth: number;
  /** Disaster markers on the map: id → time (s) to drop it at the latest. */
  private readonly disasterMarkers = new Map<number, number>();

  /**
   * Natural disaster events of a tick: a warning ring while it is coming,
   * effects when it hits, the ring removed when it is over.
   */
  onDisasters(events: readonly DisasterEvent3D[]): void {
    const t = this.lastTimeSec;
    for (const e of events) {
      const x = (e.tile % this.mapWidth) + 0.5;
      const z = Math.floor(e.tile / this.mapWidth) + 0.5;
      const long = e.kind === "storm" || e.kind === "wildfire";
      if (e.phase === "warning") {
        this.overlays.showDisaster(e.id, e.kind, x, z, e.radius, t);
        this.disasterMarkers.set(e.id, t + 60);
        this.effects.disaster(e.kind, "warning", x, z, e.radius);
      } else if (e.phase === "strike") {
        this.effects.disaster(e.kind, "strike", x, z, e.radius);
        if (!long) {
          this.overlays.hideDisaster(e.id);
          this.disasterMarkers.delete(e.id);
        }
      } else {
        this.overlays.hideDisaster(e.id);
        this.disasterMarkers.delete(e.id);
      }
    }
  }

  private pmrem: PMREMGenerator | null = null;
  private envScene: Scene | null = null;
  private envTarget: WebGLRenderTarget | null = null;
  private envAtMs = -1e9;

  /**
   * Sky reflections for water and units: the live sky (day, night,
   * weather) rendered into a prefiltered reflection map every few
   * seconds. Medium quality and up; off on the lowest settings.
   */
  private refreshReflections(nowMs: number): void {
    if (this.quality.index < 2) {
      if (this.envTarget !== null) {
        this.water.setEnvMap(null);
        this.units.setEnvMap(null);
        this.envTarget.dispose();
        this.envTarget = null;
      }
      return;
    }
    if (nowMs - this.envAtMs < 2500) return;
    this.envAtMs = nowMs;
    if (this.pmrem === null) {
      this.pmrem = new PMREMGenerator(this.renderer);
      this.envScene = new Scene();
      const dome = new Mesh(
        new SphereGeometry(50, 32, 16),
        this.environment.skyMaterial,
      );
      this.envScene.add(dome);
    }
    const next = this.pmrem.fromScene(this.envScene!, 0, 0.1, 200);
    this.water.setEnvMap(next.texture);
    this.units.setEnvMap(next.texture);
    this.envTarget?.dispose();
    this.envTarget = next;
  }

  /** Players' weapon tiers by smallID (sizes strike explosions). */
  setStrikeTiers(tiers: ReadonlyMap<number, StrikeTiers>): void {
    this.strikeTiers = tiers;
  }

  /** Buildings as flat 2D icons when zoomed out (player setting). */
  setFlatBuildingIcons(on: boolean): void {
    this.units.setIconModeAllowed(on);
  }

  /** Target war mood (0-1); the exposure eases towards it. */
  private warMood = 0;
  private warMoodShown = 0;

  setWarMood(intensity: number): void {
    this.warMood = Math.max(0, Math.min(1, intensity));
  }

  /** Country tint 0-1 (0: outlines only, 1: solid colour). */
  setTerritoryTint(strength: number): void {
    this.terrainUniforms.uFillStrength.value = Math.max(
      0,
      Math.min(1, strength),
    );
  }

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
    this.lastDtMs =
      this.lastFrameMs > 0 ? Math.min(100, nowMs - this.lastFrameMs) : 16;
    if (this.lastFrameMs > 0 && this.quality.sample(nowMs - this.lastFrameMs)) {
      this.applyQuality();
    }
    this.lastFrameMs = nowMs;

    const t = (nowMs - this.startMs) / 1000;
    this.terrainUniforms.uTime.value = t;
    this.territory.expireCaptures(nowMs);
    this.terrainUniforms.uCaptureNow.value =
      ((nowMs / CAPTURE_STAMP_MS) % CAPTURE_STAMP_PERIOD) + 1;
    // Fair-weather clouds always cast a few shadows; overcast skies more.
    const skyState = this.environment.state;
    this.terrainUniforms.uCloudCover.value =
      skyState === null ? 0.25 : 0.25 + 0.75 * skyState.cloud;
    this.water.update(t);

    // Ease into (and out of) the war mood over a few seconds.
    this.warMoodShown +=
      (this.warMood - this.warMoodShown) * Math.min(1, this.lastDtMs / 3000);
    this.renderer.toneMappingExposure = 1.05 - 0.16 * this.warMoodShown;
    const cc = this.cameraController;
    cc.step(this.lastDtMs);
    cc.sync(camera);
    this.forests.update(t, cc.distance);
    this.seaLife.update(t, cc.distance);
    this.lastTimeSec = t;
    this.refreshReflections(nowMs);
    for (const [id, until] of this.disasterMarkers) {
      // Safety net: never leave a marker if an "end" was missed.
      if (t > until) {
        this.overlays.hideDisaster(id);
        this.disasterMarkers.delete(id);
      }
    }
    this.overlays.update(cc.distance, t);
    this.units.animate(nowMs, cc.distance);
    this.units.layoutMarkers(cc.camera, this.cssWidth, this.cssHeight);
    this.effects.wake(this.units.wakes);
    this.effects.contrail(this.units.contrails);
    this.effects.tracers(this.units.tracers);
    if (this.units.flakBursts.length > 0) {
      this.effects.flak(this.units.flakBursts);
      this.units.flakBursts.length = 0;
    }
    if (this.units.launches.length > 0) {
      this.effects.muzzle(this.units.launches);
      this.units.launches.length = 0;
    }
    const sky = this.environment.state;
    this.units.setNight(sky === null ? 0 : 1 - sky.daylight);
    const fov = (cc.camera.fov * Math.PI) / 180;
    const bufferH = this.cssHeight * this.renderer.getPixelRatio();
    this.effects.update(t, bufferH / (2 * Math.tan(fov / 2)));
    this.environment.update(
      cc.focus,
      cc.viewRadius(),
      cc.distance,
      cc.camera,
      nowMs,
    );
    this.scheduleShadows();
    this.renderer.render(this.scene, cc.camera);
  }

  private scheduleShadows(): void {
    if (!this.renderer.shadowMap.enabled) return;
    const cc = this.cameraController;
    const v = this.lastShadowView;
    const moved =
      Math.abs(v[0] - cc.focus.x) > 1e-3 ||
      Math.abs(v[1] - cc.focus.y) > 1e-3 ||
      Math.abs(v[2] - cc.focus.z) > 1e-3 ||
      Math.abs(v[3] - cc.distance) > 1e-3 ||
      v[4] !== cc.yawDeg ||
      v[5] !== cc.pitchDeg;
    if (moved || ++this.shadowFrame >= SHADOW_EVERY_FRAMES) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowFrame = 0;
      v[0] = cc.focus.x;
      v[1] = cc.focus.y;
      v[2] = cc.focus.z;
      v[3] = cc.distance;
      v[4] = cc.yawDeg;
      v[5] = cc.pitchDeg;
    }
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
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.terrain.dispose();
    this.units.dispose();
    this.effects.dispose();
    this.forests.dispose();
    this.seaLife.dispose();
    this.overlays.dispose();
    this.water.dispose();
    this.terrainDetail.dispose();
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
    // A new shadow map size needs a fresh shadow pass right away.
    this.renderer.shadowMap.needsUpdate = true;
    this.effects.density =
      this.quality.index <= 0 ? 0.5 : this.quality.index === 1 ? 0.75 : 1;
    this.effects.setDetail(this.quality.index <= 1 ? 0 : 1);
  }
}
