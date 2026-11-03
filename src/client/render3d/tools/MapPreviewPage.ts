/**
 * Dev-only module: renders one map in the 3D look with no game running,
 * for the map preview generator and the all-maps 3D check
 * (scripts/maps-3d.cjs). The script opens any same-origin dev-server URL,
 * sets `window.__mapPreviewMap`, and injects this module as a script tag
 * (a standalone HTML page would get the app entry injected by the dev
 * HTML plugin).
 *
 * Exposes `window.__mapPreview` when done:
 *   { ok, map, width, height, ms, dataUrl (webp), stats } or { ok: false, error }
 */

import { assetUrl } from "@laukolaroser/shared/AssetUrls";
import { profileFor } from "../DeviceProfile";
import { WorldRenderer } from "../WorldRenderer";
import { analysePreview, type PreviewStats } from "./PreviewStats";

declare global {
  interface Window {
    __mapPreviewMap?: string;
    /** Optional sky for checking day/night and weather (default: classic). */
    __mapPreviewSky?: {
      tick: number;
      dayNight: boolean;
      weather: boolean;
      seed?: number;
      zoom?: number;
    };
    __mapPreview?:
      | {
          ok: true;
          map: string;
          width: number;
          height: number;
          ms: number;
          dataUrl: string;
          stats: PreviewStats;
        }
      | { ok: false; map: string; error: string };
  }
}

/** Palette slots; no players are drawn, so any size works. */
const PALETTE_SIZE = 64;
const OUT_W = 1200;
const OUT_H = 800;

async function run(): Promise<void> {
  const map = (window.__mapPreviewMap ?? "world").toLowerCase();
  const t0 = performance.now();
  try {
    const manifest = await (
      await fetch(assetUrl(`maps/${map}/manifest.json`))
    ).json();
    const w: number = manifest.map.width;
    const h: number = manifest.map.height;
    const bin = await fetch(assetUrl(`maps/${map}/map.bin`));
    if (!bin.ok) throw new Error(`map.bin: HTTP ${bin.status}`);
    const terrain = new Uint8Array(await bin.arrayBuffer());
    if (terrain.length !== w * h) {
      throw new Error(`map.bin has ${terrain.length} bytes, expected ${w * h}`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${OUT_W}px;height:${OUT_H}px`;
    document.body.appendChild(canvas);
    const world = new WorldRenderer({
      canvas,
      mapWidth: w,
      mapHeight: h,
      terrain,
      paletteSize: PALETTE_SIZE,
      preserveDrawingBuffer: true,
      profile: {
        ...profileFor({
          coarsePointer: false,
          maxTouchPoints: 0,
          screenShortSide: 1080,
        }),
        // Fixed quality: previews must not depend on frame timing.
        initialQuality: 3,
        maxQuality: 3,
      },
    });
    world.resize(OUT_W, OUT_H);
    // Whole map in view, a little margin.
    // The camera is tilted, so the near (bottom) edge needs extra room.
    const sky = window.__mapPreviewSky;
    if (sky !== undefined) world.setAtmosphere(sky.tick, sky, sky.seed ?? 0);
    const scale = Math.min(OUT_W / w, OUT_H / h) * 0.95 * (sky?.zoom ?? 1);
    const cam = {
      centerX: w / 2,
      centerY: h * 0.53,
      scale,
      viewWidth: OUT_W,
      viewHeight: OUT_H,
    };
    // A few frames so the camera eases in and shadows settle.
    let now = performance.now();
    for (let i = 0; i < 40; i++) {
      now += 16;
      world.render(cam, now);
    }
    // Crop to the map's projected outline (plus a small margin).
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [cx, cy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ]) {
      const p = world.tileToScreen(cx, cy);
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const pad = 10;
    x0 = Math.max(0, Math.floor(x0 - pad));
    y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(OUT_W, Math.ceil(x1 + pad));
    y1 = Math.min(OUT_H, Math.ceil(y1 + pad));
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, x1 - x0);
    crop.height = Math.max(1, y1 - y0);
    crop
      .getContext("2d")!
      .drawImage(
        canvas,
        x0,
        y0,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    const dataUrl = crop.toDataURL("image/webp", 0.86);
    const stats = analysePreview(crop, terrain);
    window.__mapPreview = {
      ok: true,
      map,
      width: w,
      height: h,
      ms: Math.round(performance.now() - t0),
      dataUrl,
      stats,
    };
    world.dispose();
  } catch (e) {
    window.__mapPreview = {
      ok: false,
      map,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

void run();
