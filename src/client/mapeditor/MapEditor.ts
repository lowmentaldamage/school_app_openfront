/**
 * The in-game map editor: paint terrain in a top-down view or in the live
 * 3D world, start from any map (built-in, saved, blank or a random island
 * group), place AI nations, and save the map to the server so everyone can
 * play it in solo games and lobbies.
 *
 * Opened from the homepage with `import()` (openMapEditor), so neither it
 * nor the 3D renderer is in the homepage chunk.
 *
 * Controls: left drag paints with the current tool; right / middle drag or
 * the Move tool pans; wheel or pinch zooms; Ctrl+Z / Ctrl+Y undo and redo.
 * In 3D, arrow keys and the compass turn and tilt the camera.
 */

import { GameMapType } from "@laukolaroser/engine-api/game/GameTypes";
import { TERRAIN_LAND } from "@laukolaroser/shared/maps/MapBuilder";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { loadModal } from "../LazyModals";
import {
  canSaveCustomMaps,
  type CustomMapInfo,
  listCustomMaps,
  saveCustomMap,
} from "../maps/CustomMapsApi";
import { OrbitControls } from "../render3d/camera/OrbitControls";
import { WorldRenderer, type WorldFrame } from "../render3d/WorldRenderer";
import type { SinglePlayerModal } from "../SinglePlayerModal";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { translateText } from "../Utils";
import {
  BRUSH_TOOLS,
  type BrushTool,
  type ImageMode,
  imageToMap,
  importSize,
  autoNationSpots,
  autoRelief,
  detectImageMode,
  isFlat,
  MapDocument,
  randomIslands,
  tileColor,
} from "./EditorCore";
import {
  decodeHeightFile,
  extensionOf,
  type HeightGrid,
  heightsToMap,
  UPLOAD_ACCEPT,
} from "./MapFileFormats";

type Tool = BrushTool | "nation" | "pan" | "orbit";

const TOOL_ICON: Record<Tool, string> = {
  water: "🌊",
  plains: "🌾",
  highland: "⛰️",
  mountain: "🏔️",
  raise: "⬆️",
  lower: "⬇️",
  nation: "🚩",
  pan: "✋",
  orbit: "🔄",
};

const SIZES: [number, number][] = [
  [512, 384],
  [1024, 768],
  [1600, 1200],
  [2000, 1500],
];

const PALETTE_SIZE = 8;
/** Tiles of the 3D preview above which it shows a half-size copy. */
const PREVIEW_FULL_TILES = 1_600_000;

const FLAG_CODES = (Countries as { code: string; name: string }[])
  .filter((c) => c.code !== "xx")
  .map((c) => c.code);
/** Two-letter country flags (real countries) for auto-placed nations. */
const COUNTRY_CODES = FLAG_CODES.filter(
  (c) => /^[a-z]{2}$/.test(c) && !["un", "eu", "aq"].includes(c),
);
const COUNTRY_NAMES = new Map(
  (Countries as { code: string; name: string }[]).map((c) => [c.code, c.name]),
);

function t(key: string, params?: Record<string, string | number>): string {
  return translateText(`map_editor.${key}`, params);
}

/** Half-size packed preview (water wins, like the game's mini maps). */
function halve(packed: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array((w >> 1) * (h >> 1));
  const ow = w >> 1;
  for (let y = 0; y < h >> 1; y++) {
    for (let x = 0; x < ow; x++) {
      const a = packed[2 * y * w + 2 * x];
      const b = packed[2 * y * w + 2 * x + 1];
      const c = packed[(2 * y + 1) * w + 2 * x];
      const d = packed[(2 * y + 1) * w + 2 * x + 1];
      out[y * ow + x] = [a, b, c, d].find((v) => !(v & 0x80)) ?? a;
    }
  }
  return out;
}

@customElement("map-editor")
export class MapEditor extends LitElement {
  @state() private tool: Tool = "plains";
  @state() private size = 8;
  @state() private view: "2d" | "3d" = "2d";
  @state() private name = "";
  @state() private statusText = "";
  private statusTimer: number | null = null;

  private get status(): string {
    return this.statusText;
  }

  /** Shown over the map; fades after a few seconds. */
  private set status(text: string) {
    this.statusText = text;
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    this.statusTimer = text
      ? window.setTimeout(() => (this.statusText = ""), 5000)
      : null;
  }
  @state() private busy = false;
  @state() private menu: "none" | "new" | "open" | "random" | "upload" = "none";
  /** The last uploaded picture, kept to convert again with other options. */
  private uploaded: {
    bitmap: ImageBitmap | null;
    grid: HeightGrid | null;
    name: string;
  } | null = null;
  /** Upload: add mountains and hills automatically (flat pictures). */
  @state() private autoTerrain = true;
  /** Upload / auto panel: nations to place, tribes (bots) the map wants. */
  @state() private nationCount = 8;
  @state() private tribes = 100;
  @state() private reliefStrength = 60;
  private orbitDrag: { x: number; y: number } | null = null;
  private detectedMode: ImageMode = "auto";
  /** Phones: the side panel (auto, nations) opens over the map. */
  @state() private showPanel = false;
  @state() private uploadMode: ImageMode = "auto";
  @state() private seaLevel = 60;
  @state() private uploadSide = 1600;
  @state() private dragOver = false;
  /** Slow 360° turn of the 3D view (after an upload); stops on input. */
  @state() private spin = false;
  private lastSpinMs = 0;
  @state() private customMaps: CustomMapInfo[] = [];
  @state() private selectedNation = -1;
  @state() private savedId: string | null = null;
  @state() private rev = 0;
  @state() private newSize = 1;
  @state() private seed = Math.floor(Math.random() * 100000);
  @state() private landShare = 40;
  @state() private islands = 3;

  private doc = MapDocument.blank(1024, 768);
  private image: HTMLCanvasElement = document.createElement("canvas");
  private imageData: ImageData | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private canvas3d: HTMLCanvasElement | null = null;
  private overlay3d: HTMLCanvasElement | null = null;
  private world: WorldRenderer | null = null;
  private orbit: OrbitControls | null = null;
  private worldVersion = -1;
  private worldScale = 1;
  private rebuildTimer: number | null = null;
  private raf = 0;
  /** View: map tile at the centre, CSS pixels per tile. */
  private cx = 512;
  private cy = 384;
  private scale = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private painting: { x: number; y: number } | null = null;
  private panning: { x: number; y: number } | null = null;
  private pinch: { d: number; scale: number } | null = null;
  private draggingNation = -1;
  private hover: { x: number; y: number } | null = null;
  private needs2d = true;
  private readonly abort = new AbortController();

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener("keydown", (e) => this.onKey(e), {
      signal: this.abort.signal,
    });
    // Capture phase: the 3D compass handles arrows before bubbling.
    globalThis.addEventListener(
      "keydown",
      (e) => {
        if ((e as KeyboardEvent).code.startsWith("Arrow")) this.spin = false;
      },
      { signal: this.abort.signal, capture: true },
    );
    globalThis.addEventListener("resize", () => this.fit(false), {
      signal: this.abort.signal,
    });
    void listCustomMaps(true).then((m) => (this.customMaps = m));
    this.startDocument(MapDocument.blank(1024, 768), "");
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.disposeWorld();
  }

  // ---------------------------------------------------------------- document

  private startDocument(doc: MapDocument, name: string): void {
    this.doc = doc;
    this.name = name;
    this.selectedNation = -1;
    this.savedId = null;
    this.image.width = doc.width;
    this.image.height = doc.height;
    this.imageData = new ImageData(doc.width, doc.height);
    this.imageData.data.fill(255);
    this.needs2d = true;
    this.worldVersion = -1;
    this.disposeWorld();
    this.fit(true);
    this.rev++;
  }

  private newBlank(): void {
    const [w, h] = SIZES[this.newSize];
    this.startDocument(MapDocument.blank(w, h), "");
    this.menu = "none";
    this.status = t("status_new");
  }

  private newRandom(): void {
    const [w, h] = SIZES[this.newSize];
    const map = randomIslands({
      width: w,
      height: h,
      seed: this.seed,
      land: this.landShare / 100,
      islands: this.islands,
    });
    this.startDocument(new MapDocument(map), t("random_name"));
    this.menu = "none";
    this.status = t("status_random", { seed: this.seed });
  }

  // ---------------------------------------------------------------- upload

  /** Read an image file, convert it and show it in 3D, turning. */
  async uploadFile(file: File): Promise<void> {
    this.busy = true;
    this.status = t("loading");
    try {
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40);
      const grid = decodeHeightFile(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      this.uploaded?.bitmap?.close();
      this.uploaded = {
        bitmap: grid ? null : await this.decodeImage(file),
        grid,
        name,
      };
      this.convertUpload();
    } catch (e) {
      this.status = t("load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.busy = false;
    }
  }

  /** Any image the browser can show (SVG and friends via <img>). */
  private async decodeImage(file: File): Promise<ImageBitmap> {
    try {
      return await createImageBitmap(file);
    } catch {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const w = img.naturalWidth || 1024;
        const h = img.naturalHeight || 1024;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(img, 0, 0, w, h);
        return await createImageBitmap(c);
      } catch {
        throw new Error(
          t("upload_unreadable", { ext: extensionOf(file.name) }),
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  private convertUpload(): void {
    const up = this.uploaded;
    if (!up) return;
    const src = up.grid ?? up.bitmap;
    if (!src) return;
    const { width, height } = importSize(
      src.width,
      src.height,
      this.uploadSide,
    );
    let map;
    if (up.grid) {
      map = heightsToMap(up.grid, width, height, this.seaLevel);
    } else {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx || !up.bitmap) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(up.bitmap, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height);
      this.detectedMode = detectImageMode({
        width,
        height,
        data: data.data,
      });
      map = imageToMap(
        { width, height, data: data.data },
        { mode: this.uploadMode, seaLevel: this.seaLevel },
      );
    }
    // Automatic 3D: map pictures and anything flat get coasts, hills and
    // mountain ranges; real height data keeps its own relief.
    const picture =
      !up.grid &&
      (this.uploadMode === "picture" ||
        (this.uploadMode === "auto" && this.detectedMode === "picture"));
    if (this.autoTerrain && (isFlat(map) || picture)) {
      map.elevation.set(autoRelief(map, this.seed, this.reliefStrength / 100));
    }
    const doc = new MapDocument(map);
    autoNationSpots(map, this.nationCount, this.seed).forEach((p, i) => {
      const n = this.nationName(i);
      doc.nations.push({ ...n, x: p.x, y: p.y });
    });
    this.startDocument(doc, up.name);
    this.menu = "none";
    this.setView("3d");
    this.spin = true;
    this.status = t("upload_done", { w: width, h: height });
  }

  /** A name and flag for the i-th auto-placed nation. */
  private nationName(i: number): { name: string; flag: string } {
    const k = (this.seed * 31 + i * 97) % COUNTRY_CODES.length;
    const code =
      COUNTRY_CODES[(k + COUNTRY_CODES.length) % COUNTRY_CODES.length] ?? "";
    const country = COUNTRY_NAMES.get(code);
    return { name: country ?? t("nation_default", { n: i + 1 }), flag: code };
  }

  private placeNations(): void {
    const spots = autoNationSpots(this.doc.map, this.nationCount, this.seed);
    this.doc.addNations(
      spots.map((p, i) => ({ ...this.nationName(i), x: p.x, y: p.y })),
      true,
    );
    this.selectedNation = -1;
    this.savedId = null;
    this.status = t("nations_placed", { n: spots.length });
    this.rev++;
  }

  private applyAutoTerrain(): void {
    this.doc.setElevation(
      autoRelief(this.doc.map, this.seed, this.reliefStrength / 100),
    );
    this.savedId = null;
    this.status = t("terrain_done");
    this.rev++;
  }

  /** Open the upload panel and the file picker. */
  showUpload(): void {
    this.menu = "upload";
    this.pickFile();
  }

  private pickFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = UPLOAD_ACCEPT;
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void this.uploadFile(f);
    };
    input.click();
  }

  private onDrop = (e: DragEvent) => {
    e.preventDefault();
    this.dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void this.uploadFile(f);
  };

  private onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    this.dragOver = true;
  };

  private async openBuiltIn(map: GameMapType): Promise<void> {
    await this.openFrom(() => terrainMapFileLoader.getMapData(map), map);
  }

  private async openCustom(info: CustomMapInfo): Promise<void> {
    await this.openFrom(
      () => terrainMapFileLoader.getCustomMapData(info.id),
      `${info.name} (2)`,
    );
  }

  private async openFrom(
    data: () => ReturnType<typeof terrainMapFileLoader.getMapData>,
    name: string,
  ): Promise<void> {
    this.busy = true;
    this.menu = "none";
    this.status = t("loading");
    try {
      const d = data();
      const [manifest, bin, levels] = await Promise.all([
        d.manifest(),
        d.mapBin(),
        d.levelsBin?.(false) ?? null,
      ]);
      const { width, height } = manifest.map;
      const doc = MapDocument.fromPacked(bin, width, height, levels);
      for (const n of manifest.nations) {
        if (!n.coordinates) continue;
        const [x, y] = n.coordinates;
        if (doc.map.kind[y * width + x] === TERRAIN_LAND) {
          doc.nations.push({ name: n.name, flag: n.flag ?? "", x, y });
        }
      }
      this.startDocument(doc, name);
      this.status = t("status_opened", { name });
    } catch (e) {
      this.status = t("load_failed", { error: String(e) });
    } finally {
      this.busy = false;
    }
  }

  // ----------------------------------------------------------------- drawing

  private redraw2dImage(): void {
    const dirty = this.doc.takeDirty();
    if (!dirty || !this.imageData) return;
    const { width } = this.doc;
    const px = this.imageData.data;
    const rgb: [number, number, number] = [0, 0, 0];
    const { kind, elevation } = this.doc.map;
    for (let y = dirty.y0; y <= dirty.y1; y++) {
      for (let x = dirty.x0; x <= dirty.x1; x++) {
        const i = y * width + x;
        tileColor(kind[i], elevation[i], rgb);
        px[i * 4] = rgb[0];
        px[i * 4 + 1] = rgb[1];
        px[i * 4 + 2] = rgb[2];
      }
    }
    this.image
      .getContext("2d")
      ?.putImageData(
        this.imageData,
        0,
        0,
        dirty.x0,
        dirty.y0,
        dirty.x1 - dirty.x0 + 1,
        dirty.y1 - dirty.y0 + 1,
      );
    this.needs2d = true;
  }

  private frame(): void {
    this.redraw2dImage();
    if (this.view === "2d") {
      if (this.needs2d) this.draw2d();
    } else {
      this.render3d();
    }
  }

  private draw2d(): void {
    const c = this.canvas2d;
    if (!c) return;
    this.needs2d = false;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);
    const ox = w / 2 - this.cx * this.scale;
    const oy = h / 2 - this.cy * this.scale;
    ctx.imageSmoothingEnabled = this.scale < 1;
    ctx.drawImage(
      this.image,
      ox,
      oy,
      this.doc.width * this.scale,
      this.doc.height * this.scale,
    );
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(
      ox,
      oy,
      this.doc.width * this.scale,
      this.doc.height * this.scale,
    );
    // Nations.
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    this.doc.nations.forEach((n, i) => {
      const sx = ox + (n.x + 0.5) * this.scale;
      const sy = oy + (n.y + 0.5) * this.scale;
      ctx.beginPath();
      ctx.arc(sx, sy, i === this.selectedNation ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === this.selectedNation ? "#facc15" : "#ef4444";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 3;
      ctx.strokeText(n.name, sx, sy - 10);
      ctx.fillText(n.name, sx, sy - 10);
    });
    // Brush outline.
    if (this.hover && (BRUSH_TOOLS as readonly string[]).includes(this.tool)) {
      ctx.beginPath();
      ctx.arc(
        ox + (this.hover.x + 0.5) * this.scale,
        oy + (this.hover.y + 0.5) * this.scale,
        Math.max(2, this.size * this.scale),
        0,
        Math.PI * 2,
      );
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }
  }

  private ensureWorld(): void {
    const c = this.canvas3d;
    if (!c) return;
    if (this.world && this.worldVersion === this.doc.version) return;
    if (this.world && this.painting) return; // rebuilt when the stroke ends
    const built = this.doc.built();
    let packed = built.map;
    let levels = built.levels;
    let w = built.width;
    let h = built.height;
    this.worldScale = 1;
    if (w * h > PREVIEW_FULL_TILES) {
      packed = halve(packed, w, h);
      levels = built.levels4x;
      w >>= 1;
      h >>= 1;
      this.worldScale = 2;
    }
    const keep = this.world?.cameraController;
    const yaw = keep?.yawDeg;
    this.disposeWorld();
    this.world = new WorldRenderer({
      canvas: c,
      mapWidth: w,
      mapHeight: h,
      terrain: packed,
      levels,
      paletteSize: PALETTE_SIZE,
    });
    this.world.setAtmosphere(1500, { dayNight: false, weather: false });
    const frame: WorldFrame = {
      tileState: new Uint16Array(w * h),
      changedTiles: null,
      units: new Map(),
      railroadState: new Uint8Array(w * h),
      railroadDirty: false,
      events: { deadUnits: [] },
    };
    this.world.updateFrame(
      frame,
      new Float32Array(PALETTE_SIZE * 2 * 4),
      performance.now(),
    );
    if (yaw !== undefined) {
      this.world.cameraController.rotateBy(
        yaw - this.world.cameraController.yawDeg,
      );
    }
    this.orbit = new OrbitControls(this.world.cameraController, c);
    this.worldVersion = this.doc.version;
  }

  private camera3d() {
    const c = this.canvas3d!;
    return {
      centerX: this.cx / this.worldScale,
      centerY: this.cy / this.worldScale,
      scale: this.scale * this.worldScale,
      viewWidth: c.clientWidth,
      viewHeight: c.clientHeight,
    };
  }

  private render3d(): void {
    if (!this.canvas3d) return;
    if (!this.world || this.worldVersion !== this.doc.version) {
      // Rebuild after a short pause, not on every dab.
      if (this.world === null) this.ensureWorld();
      else if (this.rebuildTimer === null && this.painting === null) {
        this.rebuildTimer = window.setTimeout(() => {
          this.rebuildTimer = null;
          this.ensureWorld();
        }, 250);
      }
    }
    if (!this.world) return;
    const now = performance.now();
    if (this.spin && this.lastSpinMs > 0) {
      // A full turn about every 40 seconds.
      this.world.cameraController.rotateBy(
        (Math.min(100, now - this.lastSpinMs) / 1000) * 9,
      );
    }
    this.lastSpinMs = now;
    this.orbit?.update();
    this.world.render(this.camera3d(), performance.now());
    this.drawOverlay3d();
  }

  /** Nations and the brush ring on top of the 3D view. */
  private drawOverlay3d(): void {
    const c = this.overlay3d;
    const world = this.world;
    if (!c || !world) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const k = this.worldScale;
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    this.doc.nations.forEach((n, i) => {
      const p = world.tileToScreen((n.x + 0.5) / k, (n.y + 0.5) / k);
      if (p.x < -50 || p.y < -50 || p.x > w + 50 || p.y > h + 50) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === this.selectedNation ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === this.selectedNation ? "#facc15" : "#ef4444";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111";
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(n.name, p.x, p.y - 10);
      ctx.fillStyle = "#fff";
      ctx.fillText(n.name, p.x, p.y - 10);
    });
    if (this.hover && (BRUSH_TOOLS as readonly string[]).includes(this.tool)) {
      // Brush ring: project points around the circle.
      ctx.beginPath();
      for (let a = 0; a <= 32; a++) {
        const ang = (a / 32) * Math.PI * 2;
        const p = world.tileToScreen(
          (this.hover.x + 0.5 + Math.cos(ang) * this.size) / k,
          (this.hover.y + 0.5 + Math.sin(ang) * this.size) / k,
        );
        if (a === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }
    if (this.worldVersion !== this.doc.version) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(w - 150, 8, 142, 22);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "right";
      ctx.font = "12px sans-serif";
      ctx.fillText(t("updating_3d"), w - 14, 23);
    }
  }

  private disposeWorld(): void {
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.orbit?.dispose();
    this.orbit = null;
    this.world?.dispose();
    this.world = null;
  }

  // ---------------------------------------------------------------- view

  private fit(reset: boolean): void {
    const c = this.view === "2d" ? this.canvas2d : this.canvas3d;
    // A hidden canvas measures 0: fall back to the window.
    const w = c && c.clientWidth > 0 ? c.clientWidth : globalThis.innerWidth;
    const h = c && c.clientHeight > 0 ? c.clientHeight : globalThis.innerHeight;
    if (reset) {
      this.cx = this.doc.width / 2;
      this.cy = this.doc.height / 2;
      this.scale =
        Math.min(w / this.doc.width, h / this.doc.height) * 0.95 || 1;
    }
    this.needs2d = true;
  }

  private screenToTile(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const c = this.view === "2d" ? this.canvas2d : this.canvas3d;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    if (this.view === "3d") {
      const tile = this.world?.screenToTile(px, py);
      if (!tile) return null;
      return {
        x: Math.floor(tile.x * this.worldScale),
        y: Math.floor(tile.y * this.worldScale),
      };
    }
    return {
      x: Math.floor(this.cx + (px - r.width / 2) / this.scale),
      y: Math.floor(this.cy + (py - r.height / 2) / this.scale),
    };
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const c = this.view === "2d" ? this.canvas2d : this.canvas3d;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const px = clientX - r.left - r.width / 2;
    const py = clientY - r.top - r.height / 2;
    const next = Math.max(0.05, Math.min(40, this.scale * factor));
    // Keep the tile under the cursor in place (2D).
    if (this.view === "2d") {
      this.cx += px / this.scale - px / next;
      this.cy += py / this.scale - py / next;
    }
    this.scale = next;
    this.needs2d = true;
  }

  private panBy(dx: number, dy: number): void {
    if (this.view === "3d" && this.world) {
      // Pan along the screen, turned by the camera's yaw.
      const yaw = (this.world.cameraController.yawDeg * Math.PI) / 180;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const ux = dx * c + dy * s;
      const uy = -dx * s + dy * c;
      this.cx -= ux / this.scale;
      this.cy -= uy / this.scale;
    } else {
      this.cx -= dx / this.scale;
      this.cy -= dy / this.scale;
    }
    this.cx = Math.max(0, Math.min(this.doc.width, this.cx));
    this.cy = Math.max(0, Math.min(this.doc.height, this.cy));
    this.needs2d = true;
  }

  // ---------------------------------------------------------------- input

  private onPointerDown = (e: PointerEvent) => {
    this.spin = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // Second finger: stop painting, start pinch / pan.
      this.finishStroke();
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
      this.panning = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    if (e.button === 1 || e.button === 2 || this.tool === "pan") {
      this.panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.tool === "orbit") {
      if (this.view === "2d") this.setView("3d");
      this.orbitDrag = { x: e.clientX, y: e.clientY };
      return;
    }
    const tile = this.screenToTile(e.clientX, e.clientY);
    if (!tile) return;
    if (this.tool === "nation") {
      this.handleNationDown(tile.x, tile.y);
      return;
    }
    this.doc.beginStroke();
    this.painting = tile;
    this.doc.paint(tile.x, tile.y, this.size, this.tool);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.panning)
        this.panBy(mid.x - this.panning.x, mid.y - this.panning.y);
      this.panning = mid;
      this.scale = Math.max(
        0.05,
        Math.min(40, this.pinch.scale * (d / Math.max(1, this.pinch.d))),
      );
      this.needs2d = true;
      return;
    }
    if (this.panning) {
      this.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.orbitDrag) {
      const cam = this.world?.cameraController;
      if (cam) {
        cam.rotateBy(-(e.clientX - this.orbitDrag.x) * 0.4);
        cam.tiltBy((e.clientY - this.orbitDrag.y) * 0.25);
      }
      this.orbitDrag = { x: e.clientX, y: e.clientY };
      return;
    }
    const tile = this.screenToTile(e.clientX, e.clientY);
    this.hover = tile;
    this.needs2d = true;
    if (!tile) return;
    if (this.draggingNation >= 0) {
      this.doc.moveNation(this.draggingNation, tile.x, tile.y);
      return;
    }
    if (
      this.painting &&
      this.tool !== "nation" &&
      this.tool !== "pan" &&
      this.tool !== "orbit"
    ) {
      this.doc.paintLine(
        this.painting.x,
        this.painting.y,
        tile.x,
        tile.y,
        this.size,
        this.tool,
      );
      this.painting = tile;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.panning = null;
      this.orbitDrag = null;
      if (this.draggingNation >= 0) {
        this.draggingNation = -1;
        this.doc.endStroke();
        this.rev++;
      }
      this.finishStroke();
    }
  };

  private finishStroke(): void {
    if (this.painting) {
      this.painting = null;
      this.doc.endStroke();
      this.savedId = null;
      this.rev++;
    }
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  };

  private handleNationDown(x: number, y: number): void {
    const near = this.doc.nationAt(x, y, Math.max(3, 8 / this.scale));
    this.doc.beginStroke();
    if (near >= 0) {
      this.selectedNation = near;
      this.draggingNation = near;
      return;
    }
    const n = this.doc.nations.length + 1;
    if (
      this.doc.addNation(
        x,
        y,
        t("nation_default", { n }),
        FLAG_CODES[(n * 37) % FLAG_CODES.length] ?? "",
      )
    ) {
      this.selectedNation = this.doc.nations.length - 1;
      this.savedId = null;
    } else {
      this.status = t("nation_on_land");
    }
    this.doc.endStroke();
    this.rev++;
  }

  private onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT")) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
      e.preventDefault();
      this.redo();
    } else if (e.code === "BracketLeft" && this.view === "2d") {
      this.size = Math.max(1, this.size - 1);
    } else if (e.code === "BracketRight" && this.view === "2d") {
      this.size = Math.min(80, this.size + 1);
    } else if (e.code === "Escape" && this.menu !== "none") {
      this.menu = "none";
    }
  }

  private undo(): void {
    if (this.doc.undo()) {
      this.savedId = null;
      this.clampSelection();
      this.rev++;
    }
  }

  private redo(): void {
    if (this.doc.redo()) {
      this.savedId = null;
      this.clampSelection();
      this.rev++;
    }
  }

  private clampSelection(): void {
    if (this.selectedNation >= this.doc.nations.length) {
      this.selectedNation = -1;
    }
  }

  private setView(v: "2d" | "3d"): void {
    if (v === this.view) return;
    this.view = v;
    if (v === "2d") this.disposeWorld();
    this.needs2d = true;
  }

  // ---------------------------------------------------------------- saving

  private async thumbnail(): Promise<string | undefined> {
    const max = 480;
    const k = Math.min(1, max / Math.max(this.doc.width, this.doc.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(this.doc.width * k));
    c.height = Math.max(1, Math.round(this.doc.height * k));
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.image, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) =>
      c.toBlob(r, "image/webp", 0.8),
    );
    if (!blob) return undefined;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      this.status = t("name_needed");
      return;
    }
    if (this.doc.landTiles() < 100) {
      this.status = t("land_needed");
      return;
    }
    if (!canSaveCustomMaps()) {
      this.status = t("login_needed");
      return;
    }
    this.busy = true;
    this.status = t("saving");
    try {
      const built = this.doc.built();
      const id = await saveCustomMap(
        {
          name,
          width: this.doc.width,
          height: this.doc.height,
          nations: this.doc.nations.map((n) => ({
            name: n.name.trim() || "Nation",
            flag: n.flag,
            coordinates: [n.x, n.y],
          })),
          tribes: this.tribes,
          thumbnail: await this.thumbnail(),
        },
        built.map,
        built.levels,
      );
      this.savedId = id;
      this.customMaps = await listCustomMaps(true);
      this.status = t("saved");
    } catch (e) {
      this.status = t("save_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.busy = false;
    }
  }

  private async playSolo(): Promise<void> {
    const id = this.savedId;
    if (!id) return;
    const name = this.name.trim();
    await loadModal("single-player-modal");
    const modal = document.querySelector(
      "single-player-modal",
    ) as SinglePlayerModal | null;
    this.close();
    if (modal) {
      modal.open();
      await modal.selectCustomMap({ id, name, tribes: this.tribes });
    }
  }

  close(): void {
    this.remove();
  }

  // ---------------------------------------------------------------- render

  private renderMenu() {
    if (this.menu === "none") return nothing;
    const sizeSelect = html`<label class="flex flex-col gap-1 text-sm">
      ${t("size")}
      <select
        class="rounded bg-slate-800 px-2 py-1"
        .value=${String(this.newSize)}
        @change=${(e: Event) =>
          (this.newSize = Number((e.target as HTMLSelectElement).value))}
      >
        ${SIZES.map(
          ([w, h], i) =>
            html`<option value=${i} ?selected=${i === this.newSize}>
              ${w} × ${h}
            </option>`,
        )}
      </select>
    </label>`;
    let body;
    if (this.menu === "upload") {
      const sideSelect = html`<label class="flex flex-col gap-1 text-sm">
        ${t("upload_size")}
        <select
          class="rounded bg-slate-800 px-2 py-1"
          @change=${(e: Event) =>
            (this.uploadSide = Number((e.target as HTMLSelectElement).value))}
        >
          ${[800, 1200, 1600, 2000].map(
            (v) =>
              html`<option value=${v} ?selected=${v === this.uploadSide}>
                ${t("upload_max", { n: v })}
              </option>`,
          )}
        </select>
      </label>`;
      body = html`<p class="text-xs text-white/70">${t("upload_hint")}</p>
        <button
          class="lkr-ed-btn bg-sky-600 py-3 font-bold"
          ?disabled=${this.busy}
          @click=${() => this.pickFile()}
        >
          📤 ${t("upload_choose")}
        </button>
        <label class="flex flex-col gap-1 text-sm">
          ${t("upload_mode")}
          <select
            class="rounded bg-slate-800 px-2 py-1"
            @change=${(e: Event) =>
              (this.uploadMode = (e.target as HTMLSelectElement)
                .value as ImageMode)}
          >
            ${(["auto", "picture", "heightmap", "game"] as const).map(
              (m) =>
                html`<option value=${m} ?selected=${m === this.uploadMode}>
                  ${t(`mode_${m}`)}
                </option>`,
            )}
          </select>
        </label>
        ${
          this.uploadMode === "heightmap" || this.uploadMode === "auto"
            ? html`<label class="flex flex-col gap-1 text-sm">
                ${t("sea_level", { n: this.seaLevel })}
                <input
                  type="range"
                  min="0"
                  max="200"
                  .value=${String(this.seaLevel)}
                  @input=${(e: Event) =>
                    (this.seaLevel = Number(
                      (e.target as HTMLInputElement).value,
                    ))}
                />
              </label>`
            : nothing
        }
        ${sideSelect}
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            .checked=${this.autoTerrain}
            @change=${(e: Event) =>
              (this.autoTerrain = (e.target as HTMLInputElement).checked)}
          />
          ✨ ${t("upload_auto_terrain")}
        </label>
        <label class="flex items-center justify-between gap-2 text-sm">
          ${t("nation_count")}
          <input
            type="number"
            min="0"
            max="200"
            class="w-20 rounded bg-slate-800 px-1 py-0.5 text-right"
            .value=${String(this.nationCount)}
            @change=${(e: Event) =>
              (this.nationCount = Math.max(
                0,
                Math.min(200, Number((e.target as HTMLInputElement).value) | 0),
              ))}
          />
        </label>
        ${
          this.uploaded
            ? html`<button
                class="lkr-ed-btn bg-slate-700"
                @click=${() => this.convertUpload()}
              >
                🔁 ${t("upload_again", { name: this.uploaded.name })}
              </button>`
            : nothing
        }`;
    } else if (this.menu === "new") {
      body = html`${sizeSelect}
        <button class="lkr-ed-btn bg-sky-600" @click=${() => this.newBlank()}>
          ${t("create_blank")}
        </button>`;
    } else if (this.menu === "random") {
      body = html`${sizeSelect}
        <label class="flex flex-col gap-1 text-sm">
          ${t("seed")}
          <input
            type="number"
            class="rounded bg-slate-800 px-2 py-1"
            .value=${String(this.seed)}
            @input=${(e: Event) =>
              (this.seed = Number((e.target as HTMLInputElement).value) | 0)}
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          ${t("land_share", { n: this.landShare })}
          <input
            type="range"
            min="10"
            max="80"
            .value=${String(this.landShare)}
            @input=${(e: Event) =>
              (this.landShare = Number((e.target as HTMLInputElement).value))}
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          ${t("island_count", { n: this.islands })}
          <input
            type="range"
            min="1"
            max="8"
            .value=${String(this.islands)}
            @input=${(e: Event) =>
              (this.islands = Number((e.target as HTMLInputElement).value))}
          />
        </label>
        <div class="flex gap-2">
          <button
            class="lkr-ed-btn bg-slate-700"
            @click=${() => (this.seed = Math.floor(Math.random() * 100000))}
          >
            🎲 ${t("new_seed")}
          </button>
          <button
            class="lkr-ed-btn bg-sky-600 flex-1"
            @click=${() => this.newRandom()}
          >
            ${t("generate")}
          </button>
        </div>`;
    } else {
      const builtIn = Object.values(GameMapType).filter(
        (m) => m !== GameMapType.Tutorial,
      );
      body = html`
        ${
          this.customMaps.length > 0
            ? html`<div class="text-xs uppercase text-white/60">
                  ${t("saved_maps")}
                </div>
                <div class="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  ${this.customMaps.map(
                    (m) =>
                      html`<button
                        class="lkr-ed-btn bg-slate-800 text-left"
                        @click=${() => void this.openCustom(m)}
                      >
                        ${m.name}
                        <span class="text-white/50 text-xs">
                          ${m.width}×${m.height}${m.author ? ` · ${m.author}` : ""}
                        </span>
                      </button>`,
                  )}
                </div>`
            : nothing
        }
        <div class="text-xs uppercase text-white/60">${t("game_maps")}</div>
        <div class="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto">
          ${builtIn.map(
            (m) =>
              html`<button
                class="lkr-ed-btn bg-slate-800 text-left text-xs"
                @click=${() => void this.openBuiltIn(m)}
              >
                ${m}
              </button>`,
          )}
        </div>
      `;
    }
    return html`<div
      class="absolute left-1/2 top-16 z-20 w-[min(calc(100%-1rem),26rem)] max-h-[calc(100%-5rem)] overflow-y-auto -translate-x-1/2 rounded-xl border border-white/15 bg-slate-900/95 p-4 shadow-2xl flex flex-col gap-3"
    >
      <div class="flex items-center justify-between">
        <h3 class="font-bold uppercase tracking-wider">
          ${t(`menu_${this.menu}`)}
        </h3>
        <button
          class="text-white/60 hover:text-white"
          @click=${() => (this.menu = "none")}
          aria-label=${t("close")}
        >
          ✕
        </button>
      </div>
      ${body}
    </div>`;
  }

  private renderAuto() {
    const num = (
      label: string,
      value: number,
      max: number,
      set: (v: number) => void,
    ) =>
      html`<label class="flex items-center justify-between gap-2 text-xs">
        ${label}
        <input
          type="number"
          min="0"
          max=${max}
          class="w-20 rounded bg-slate-800 px-1 py-0.5 text-right"
          .value=${String(value)}
          @change=${(e: Event) =>
            set(
              Math.max(
                0,
                Math.min(max, Number((e.target as HTMLInputElement).value) | 0),
              ),
            )}
        />
      </label>`;
    return html`<div class="flex flex-col gap-2 rounded-lg bg-white/5 p-2">
      <h3 class="text-xs font-bold uppercase tracking-wider text-white/70">
        ✨ ${t("auto_title")}
      </h3>
      <button
        class="lkr-ed-btn bg-violet-700"
        title=${t("auto_terrain_hint")}
        @click=${() => this.applyAutoTerrain()}
      >
        ⛰️ ${t("auto_terrain")}
      </button>
      <label class="flex flex-col gap-1 text-xs">
        ${t("relief_strength", { n: this.reliefStrength })}
        <input
          type="range"
          min="0"
          max="100"
          .value=${String(this.reliefStrength)}
          @input=${(e: Event) =>
            (this.reliefStrength = Number(
              (e.target as HTMLInputElement).value,
            ))}
        />
      </label>
      ${num(t("nation_count"), this.nationCount, 200, (v) => (this.nationCount = v))}
      <button
        class="lkr-ed-btn bg-violet-700"
        @click=${() => this.placeNations()}
      >
        🚩 ${t("place_nations", { n: this.nationCount })}
      </button>
      ${num(t("tribe_count"), this.tribes, 400, (v) => {
        this.tribes = v;
        this.savedId = null;
      })}
      <p class="text-[11px] leading-snug text-white/50">${t("tribes_hint")}</p>
    </div>`;
  }

  private renderNations() {
    const nations = this.doc.nations;
    return html`<div class="flex flex-col gap-2 min-h-0">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-bold uppercase tracking-wider text-white/70">
          ${t("nations", { n: nations.length })}
        </h3>
        <button
          class="text-xs text-sky-300 hover:text-sky-200"
          @click=${() => (this.tool = "nation")}
        >
          + ${t("add_nation")}
        </button>
      </div>
      <datalist id="lkr-ed-flags">
        ${FLAG_CODES.map((c) => html`<option value=${c}></option>`)}
      </datalist>
      <div class="flex flex-col gap-1 overflow-y-auto min-h-0 pr-1">
        ${
          nations.length === 0
            ? html`<p class="text-xs text-white/50">${t("nations_hint")}</p>`
            : nothing
        }
        ${nations.map(
          (n, i) =>
            html`<div
              class="flex items-center gap-1 rounded px-1 py-1 ${
                i === this.selectedNation ? "bg-yellow-500/20" : "bg-white/5"
              }"
              @click=${() => {
                this.selectedNation = i;
                this.cx = n.x;
                this.cy = n.y;
                this.needs2d = true;
              }}
            >
              <input
                class="min-w-0 flex-1 rounded bg-slate-800 px-1 py-0.5 text-xs"
                maxlength="40"
                .value=${n.name}
                @change=${(e: Event) => {
                  this.doc.beginStroke();
                  this.doc.renameNation(
                    i,
                    (e.target as HTMLInputElement).value,
                    n.flag,
                  );
                  this.doc.endStroke();
                  this.savedId = null;
                  this.rev++;
                }}
              />
              <input
                class="w-20 rounded bg-slate-800 px-1 py-0.5 text-xs"
                list="lkr-ed-flags"
                placeholder=${t("flag")}
                .value=${n.flag}
                @change=${(e: Event) => {
                  this.doc.beginStroke();
                  this.doc.renameNation(
                    i,
                    n.name,
                    (e.target as HTMLInputElement).value,
                  );
                  this.doc.endStroke();
                  this.savedId = null;
                  this.rev++;
                }}
              />
              <button
                class="px-1 text-red-300 hover:text-red-200"
                title=${t("remove")}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.doc.beginStroke();
                  this.doc.removeNation(i);
                  this.doc.endStroke();
                  this.selectedNation = -1;
                  this.savedId = null;
                  this.rev++;
                }}
              >
                ✕
              </button>
            </div>`,
        )}
      </div>
    </div>`;
  }

  render() {
    void this.rev;
    const land = this.doc.landTiles();
    const pct = Math.round((land / (this.doc.width * this.doc.height)) * 100);
    const tools: Tool[] = [...BRUSH_TOOLS, "nation", "pan", "orbit"];
    return html`
      <style>
        .lkr-ed-btn {
          border-radius: 0.5rem;
          padding: 0.375rem 0.625rem;
          font-size: 0.875rem;
          color: white;
          transition: filter 0.15s;
        }
        .lkr-ed-btn:hover:not(:disabled) {
          filter: brightness(1.2);
        }
        .lkr-ed-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      </style>
      <div
        class="fixed inset-0 z-[200] flex flex-col bg-slate-950 text-white select-none"
        @contextmenu=${(e: Event) => e.preventDefault()}
        @dragover=${this.onDragOver}
        @dragleave=${(e: DragEvent) => {
          if (e.relatedTarget === null) this.dragOver = false;
        }}
        @drop=${this.onDrop}
      >
        ${
          this.dragOver
            ? html`<div
                class="pointer-events-none fixed inset-0 z-[210] flex items-center justify-center border-4 border-dashed border-sky-400 bg-sky-900/60 text-2xl font-bold"
              >
                📤 ${t("drop_here")}
              </div>`
            : nothing
        }
        <header
          class="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-900 px-3 py-2"
        >
          <h2 class="font-bold uppercase tracking-widest text-sky-300 mr-2">
            ${t("title")}
          </h2>
          <input
            class="w-44 rounded bg-slate-800 px-2 py-1 text-sm"
            maxlength="40"
            placeholder=${t("name_placeholder")}
            .value=${this.name}
            @input=${(e: Event) => {
              this.name = (e.target as HTMLInputElement).value;
              this.savedId = null;
            }}
          />
          <button
            class="lkr-ed-btn bg-slate-700"
            @click=${() => (this.menu = "new")}
          >
            📄<span class="sr-only sm:not-sr-only"> ${t("new")}</span>
          </button>
          <button
            class="lkr-ed-btn bg-slate-700"
            @click=${() => (this.menu = "random")}
          >
            🏝️<span class="sr-only sm:not-sr-only"> ${t("random")}</span>
          </button>
          <button
            class="lkr-ed-btn bg-slate-700"
            @click=${() => (this.menu = "open")}
          >
            📂<span class="sr-only sm:not-sr-only"> ${t("open")}</span>
          </button>
          <button
            class="lkr-ed-btn bg-sky-700"
            @click=${() => (this.menu = "upload")}
          >
            📤<span class="sr-only sm:not-sr-only"> ${t("upload")}</span>
          </button>
          <span class="mx-1 h-6 w-px bg-white/15"></span>
          <button
            class="lkr-ed-btn bg-slate-700"
            ?disabled=${!this.doc.canUndo()}
            title="Ctrl+Z"
            @click=${() => this.undo()}
          >
            ↶<span class="sr-only sm:not-sr-only"> ${t("undo")}</span>
          </button>
          <button
            class="lkr-ed-btn bg-slate-700"
            ?disabled=${!this.doc.canRedo()}
            title="Ctrl+Y"
            @click=${() => this.redo()}
          >
            ↷<span class="sr-only sm:not-sr-only"> ${t("redo")}</span>
          </button>
          <span class="mx-1 h-6 w-px bg-white/15"></span>
          <div class="flex overflow-hidden rounded-lg border border-white/15">
            <button
              class="px-3 py-1 text-sm ${
                this.view === "2d" ? "bg-sky-600" : "bg-slate-800"
              }"
              @click=${() => this.setView("2d")}
            >
              2D
            </button>
            <button
              class="px-3 py-1 text-sm ${
                this.view === "3d" ? "bg-sky-600" : "bg-slate-800"
              }"
              @click=${() => this.setView("3d")}
            >
              3D
            </button>
          </div>
          ${
            this.view === "3d"
              ? html`<button
                  class="lkr-ed-btn ${this.spin ? "bg-sky-600" : "bg-slate-700"}"
                  title=${t("spin_hint")}
                  @click=${() => (this.spin = !this.spin)}
                >
                  🔄<span class="sr-only sm:not-sr-only"> ${t("spin")}</span>
                </button>`
              : nothing
          }
          <div class="ml-auto flex items-center gap-2">
            ${
              this.savedId
                ? html`<button
                    class="lkr-ed-btn bg-emerald-600"
                    @click=${() => void this.playSolo()}
                  >
                    ▶<span class="sr-only sm:not-sr-only">
                      ${t("play_solo")}</span
                    >
                  </button>`
                : nothing
            }
            <button
              class="lkr-ed-btn bg-sky-600 font-bold"
              ?disabled=${this.busy || this.savedId !== null}
              title=${this.savedId ? t("saved_already") : ""}
              @click=${() => void this.save()}
            >
              💾<span class="sr-only sm:not-sr-only"> ${t("save")}</span>
            </button>
            <button
              class="lkr-ed-btn bg-slate-700"
              @click=${() => this.close()}
            >
              ✕<span class="sr-only sm:not-sr-only"> ${t("close")}</span>
            </button>
            <button
              class="lkr-ed-btn bg-slate-700 md:hidden"
              @click=${() => (this.showPanel = !this.showPanel)}
            >
              ☰
            </button>
          </div>
        </header>
        <div class="relative flex min-h-0 flex-1">
          <aside
            class="flex w-16 flex-col items-center gap-1 border-r border-white/10 bg-slate-900 py-2 sm:w-20"
          >
            ${tools.map(
              (tool) =>
                html`<button
                  class="flex w-14 flex-col items-center rounded-lg py-1 text-[10px] leading-tight sm:w-16 ${
                    this.tool === tool
                      ? "bg-sky-600"
                      : "bg-slate-800 hover:bg-slate-700"
                  }"
                  title=${t(`tool_${tool}_hint`)}
                  @click=${() => (this.tool = tool)}
                >
                  <span class="text-lg">${TOOL_ICON[tool]}</span>
                  ${t(`tool_${tool}`)}
                </button>`,
            )}
            <label
              class="mt-2 flex flex-col items-center gap-1 text-[10px] text-white/70"
            >
              ${t("brush", { n: this.size })}
              <input
                type="range"
                min="1"
                max="80"
                class="h-28 w-4 [writing-mode:vertical-lr] [direction:rtl]"
                .value=${String(this.size)}
                @input=${(e: Event) =>
                  (this.size = Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </aside>
          <main class="relative min-w-0 flex-1">
            <canvas
              class="absolute inset-0 h-full w-full touch-none ${
                this.view === "2d" ? "" : "hidden"
              } ${this.tool === "pan" ? "cursor-grab" : "cursor-crosshair"}"
              @pointerdown=${this.onPointerDown}
              @pointermove=${this.onPointerMove}
              @pointerup=${this.onPointerUp}
              @pointercancel=${this.onPointerUp}
              @pointerleave=${() => {
                this.hover = null;
                this.needs2d = true;
              }}
              @wheel=${this.onWheel}
              data-view="2d"
            ></canvas>
            ${
              this.view === "3d"
                ? html`<canvas
                      class="absolute inset-0 h-full w-full touch-none cursor-crosshair"
                      @pointerdown=${this.onPointerDown}
                      @pointermove=${this.onPointerMove}
                      @pointerup=${this.onPointerUp}
                      @pointercancel=${this.onPointerUp}
                      @pointerleave=${() => (this.hover = null)}
                      @wheel=${this.onWheel}
                      data-view="3d"
                    ></canvas>
                    <canvas
                      class="pointer-events-none absolute inset-0 h-full w-full"
                      data-view="3d-overlay"
                    ></canvas>`
                : nothing
            }
            <div
              class="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white/80"
            >
              ${this.doc.width}×${this.doc.height} · ${t("land", { n: pct })} ·
              ${t(`tool_${this.tool}_hint`)}
            </div>
            ${
              this.status
                ? html`<div
                    class="absolute left-1/2 top-2 -translate-x-1/2 rounded-lg bg-black/75 px-3 py-1.5 text-sm"
                  >
                    ${this.status}
                  </div>`
                : nothing
            }
            ${this.renderMenu()}
          </main>
          <aside
            class="${
              this.showPanel ? "absolute inset-y-0 right-0 z-30 flex" : "hidden"
            } w-72 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-slate-900 p-3 md:static md:flex"
          >
            ${this.renderAuto()} ${this.renderNations()}
            <p class="mt-auto text-[11px] leading-snug text-white/50">
              ${t("help")}
            </p>
          </aside>
        </div>
      </div>
    `;
  }

  protected updated(): void {
    const c2 = this.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]');
    if (c2 !== this.canvas2d) {
      this.canvas2d = c2;
      this.fit(true);
    }
    const c3 = this.querySelector<HTMLCanvasElement>('canvas[data-view="3d"]');
    if (c3 !== this.canvas3d) {
      this.disposeWorld();
      this.canvas3d = c3;
    }
    this.overlay3d = this.querySelector<HTMLCanvasElement>(
      'canvas[data-view="3d-overlay"]',
    );
    this.needs2d = true;
  }
}

/** Opens the editor over the homepage. */
export function openMapEditor(opts: { upload?: boolean } = {}): void {
  let editor = document.querySelector<MapEditor>("map-editor");
  if (!editor) {
    editor = document.createElement("map-editor") as MapEditor;
    document.body.appendChild(editor);
  }
  if (opts.upload) editor.showUpload();
}
