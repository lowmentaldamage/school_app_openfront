/**
 * Dev-only module: a small staged scene (two nations, every building, a
 * few ships and a bomber) for checking models, surface detail, night
 * lights and the conquest animation without running a game. Used like
 * MapPreviewPage: open any same-origin dev-server URL, set
 * `window.__showcase`, inject this module as a script tag, wait for
 * `window.__showcaseResult` ({ ok, dataUrl } or { ok: false, error }).
 *
 * Options: { night?: boolean; captureAtMs?: number (ms after a conquest
 * wave, omit for none); zoom?: number; cx?: number; cy?: number (tile to
 * centre on) }.
 */

import { profileFor } from "../DeviceProfile";
import type { UnitInput } from "../units/UnitRenderer";
import { WorldRenderer, type WorldFrame } from "../WorldRenderer";

declare global {
  interface Window {
    __showcase?: {
      night?: boolean;
      captureAtMs?: number;
      zoom?: number;
      /** Tile to centre on (default: the middle of the stage). */
      cx?: number;
      cy?: number;
      /** Detonate this unit type at the centre (e.g. "Atom Bomb"). */
      explosion?: string;
      /** ms after the detonation to capture (default 600). */
      explosionAtMs?: number;
      /** Play a natural disaster at the centre (warning, then strike). */
      disaster?: string;
      /** ms after the strike to capture (default 1500; < 0: the warning). */
      disasterAtMs?: number;
    };
    __showcaseResult?:
      | { ok: true; dataUrl: string }
      | { ok: false; error: string };
  }
}

const W = 64;
const H = 48;
const PALETTE_SIZE = 8;
const OUT_W = 1200;
const OUT_H = 800;

function terrain(): Uint8Array {
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= 50) {
        t[y * W + x] = 1 << 5; // ocean
        continue;
      }
      // Rolling plains, a ridge in the north-west corner.
      let mag = 3 + Math.round(2 * Math.sin(x * 0.3) * Math.cos(y * 0.25));
      if (x < 14 && y < 12) mag = 18 + ((x + y) % 5);
      t[y * W + x] = (1 << 7) | Math.max(0, Math.min(30, mag));
    }
  }
  return t;
}

function palette(): Float32Array {
  const p = new Float32Array(PALETTE_SIZE * 2 * 4);
  const set = (id: number, fill: number[], border: number[]) => {
    p.set([...fill, 1], id * 4);
    p.set([...border, 1], (PALETTE_SIZE + id) * 4);
  };
  set(1, [0.2, 0.45, 0.85], [0.35, 0.65, 1.0]);
  set(2, [0.85, 0.3, 0.25], [1.0, 0.5, 0.4]);
  return p;
}

let nextId = 1;
function unit(
  unitType: string,
  owner: number,
  x: number,
  y: number,
  extra: Partial<UnitInput> = {},
): [number, UnitInput] {
  const id = nextId++;
  const pos = y * W + x;
  return [
    id,
    {
      id,
      unitType,
      ownerID: owner,
      pos,
      lastPos: pos,
      isActive: true,
      waitTicks: 0,
      level: 1,
      underConstruction: false,
      targetTile: null,
      targetUnitId: null,
      trainType: null,
      loaded: null,
      ...extra,
    },
  ];
}

async function run(): Promise<void> {
  const opts = window.__showcase ?? {};
  try {
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${OUT_W}px;height:${OUT_H}px`;
    document.body.appendChild(canvas);
    const world = new WorldRenderer({
      canvas,
      mapWidth: W,
      mapHeight: H,
      terrain: terrain(),
      paletteSize: PALETTE_SIZE,
      preserveDrawingBuffer: true,
      profile: {
        ...profileFor({
          coarsePointer: false,
          maxTouchPoints: 0,
          screenShortSide: 1080,
        }),
        initialQuality: 3,
        maxQuality: 3,
      },
    });
    world.resize(OUT_W, OUT_H);

    const tiles = new Uint16Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 50; x++) tiles[y * W + x] = x < 26 ? 1 : 2;
    }
    const units = new Map<number, UnitInput>([
      unit("City", 1, 8, 20),
      unit("City", 2, 38, 16, { level: 3 }),
      unit("Factory", 1, 16, 30),
      unit("Market", 2, 32, 30),
      unit("Port", 2, 48, 24),
      unit("Airbase", 1, 10, 38),
      unit("Defense Post", 2, 28, 22),
      unit("SAM Launcher", 1, 20, 14),
      unit("Missile Silo", 2, 42, 38),
      unit("Gold Mine", 1, 6, 6),
      unit("Oil Rig", 2, 55, 34),
      unit("Warship", 2, 54, 14, { lastPos: 13 * W + 53 }),
      unit("Battleship", 1, 58, 22, { lastPos: 22 * W + 59 }),
      unit("Aircraft Carrier", 2, 57, 40, { lastPos: 39 * W + 57 }),
      unit("Bomber", 1, 30, 10, { lastPos: 10 * W + 29 }),
    ]);
    const frame = (changed: number[] | null): WorldFrame => ({
      tileState: tiles,
      changedTiles: changed,
      units,
      railroadState: new Uint8Array(W * H),
      railroadDirty: false,
      events: { deadUnits: [] },
    });
    const pal = palette();
    world.setAtmosphere(opts.night ? 4900 : 1500, {
      dayNight: true,
      weather: false,
    });

    let now = performance.now();
    world.updateFrame(frame(null), pal, now);
    // Let the building icon atlas load.
    await new Promise((r) => setTimeout(r, 2500));
    const cam = {
      centerX: opts.cx ?? W / 2,
      centerY: opts.cy ?? H * 0.52,
      scale: (Math.min(OUT_W / W, OUT_H / H) * 0.95 * (opts.zoom ?? 1)) | 0,
      viewWidth: OUT_W,
      viewHeight: OUT_H,
    };
    for (let i = 0; i < 50; i++) {
      now += 16;
      world.render(cam, now);
    }
    if (opts.explosion !== undefined) {
      const pos = Math.round(cam.centerY) * W + Math.round(cam.centerX);
      world.updateFrame(
        {
          ...frame([]),
          events: {
            deadUnits: [{ unitType: opts.explosion, pos, reachedTarget: true }],
          },
        },
        pal,
        now,
      );
      const end = now + (opts.explosionAtMs ?? 600);
      // At most ~60 frames: the software renderer is slow.
      const step = Math.max(16, (end - now) / 60);
      while (now < end) {
        now = Math.min(end, now + step);
        world.render(cam, now);
      }
    }
    if (opts.disaster !== undefined) {
      const tile = Math.round(cam.centerY) * W + Math.round(cam.centerX);
      const base = { id: 1, kind: opts.disaster, tile, radius: 12 };
      world.onDisasters([{ ...base, phase: "warning" }]);
      for (let i = 0; i < 60; i++) {
        now += 16;
        world.render(cam, now);
      }
      // A negative time captures the warning (no strike).
      const after = opts.disasterAtMs ?? 1500;
      if (after >= 0) world.onDisasters([{ ...base, phase: "strike" }]);
      const end = now + Math.max(0, after);
      const step = Math.max(16, (end - now) / 60);
      while (now < end) {
        now = Math.min(end, now + step);
        world.render(cam, now);
      }
    }
    if (opts.captureAtMs !== undefined) {
      // Nation 1 takes a band of nation 2's land.
      const changed: number[] = [];
      for (let y = 0; y < H; y++) {
        for (let x = 26; x < 34; x++) {
          tiles[y * W + x] = 1;
          changed.push(y * W + x);
        }
      }
      world.updateFrame(frame(changed), pal, now);
      const end = now + opts.captureAtMs;
      while (now < end) {
        now = Math.min(end, now + 16);
        world.render(cam, now);
      }
    }
    window.__showcaseResult = {
      ok: true,
      dataUrl: canvas.toDataURL("image/png"),
    };
    world.dispose();
  } catch (e) {
    window.__showcaseResult = {
      ok: false,
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    };
  }
}

void run();
