/**
 * Pure helpers for the 3D unit layer: which model a simulation unit uses,
 * and the flight-path maths for missiles and shells. No three.js imports,
 * so this is unit tested directly.
 */

import { radarRange } from "@laukolaroser/engine-lib/defense/Radar";
import type { ModelKind } from "./UnitModels";

/** Minimal unit fields the classifier reads (subset of UnitState). */
export interface UnitLike {
  unitType: string;
  trainType: number | null;
  loaded: boolean | null;
}

const BY_TYPE: Record<string, ModelKind> = {
  Warship: "warship",
  Destroyer: "destroyer",
  Battleship: "battleship",
  Submarine: "submarine",
  "Aircraft Carrier": "carrier",
  "Armored Train": "armoredTrain",
  "Troop Train": "troopTrain",
  "Rail SAM": "railSam",
  "Gold Mine": "goldMine",
  Market: "market",
  "Oil Rig": "oilRig",
  Airbase: "airbase",
  "Radar Station": "radarStation",
  "Flak Gun": "flakGun",
  Fort: "fort",
  "Coastal Battery": "coastalBattery",
  "Sea Mine": "seaMine",
  Bomber: "bomber",
  Fighter: "fighter",
  Transport: "transport",
  "Trade Ship": "tradeShip",
  "Atom Bomb": "atomBomb",
  "Hydrogen Bomb": "hydrogenBomb",
  MIRV: "mirv",
  "MIRV Warhead": "mirvWarhead",
  SAMMissile: "samMissile",
  Shell: "shell",
  "Artillery Shell": "artilleryShell",
  Rocket: "rocket",
  City: "city",
  Port: "port",
  Factory: "factory",
  "Defense Post": "defensePost",
  "SAM Launcher": "samLauncher",
  "Missile Silo": "missileSilo",
};

export const STRUCTURE_KINDS: ReadonlySet<ModelKind> = new Set<ModelKind>([
  "goldMine",
  "market",
  "oilRig",
  "airbase",
  "radarStation",
  "flakGun",
  "fort",
  "coastalBattery",
  "seaMine",
  "city",
  "port",
  "factory",
  "defensePost",
  "samLauncher",
  "missileSilo",
]);

export const SHIP_KINDS: ReadonlySet<ModelKind> = new Set<ModelKind>([
  "warship",
  "destroyer",
  "battleship",
  "submarine",
  "carrier",
  "transport",
  "tradeShip",
]);

/** Planes: fly level at cruise height. */
export const AIR_KINDS: ReadonlySet<ModelKind> = new Set<ModelKind>([
  "bomber",
  "fighter",
]);

export const TRAIN_KINDS: ReadonlySet<ModelKind> = new Set<ModelKind>([
  "trainEngine",
  "expressEngine",
  "armoredTrain",
  "troopTrain",
  "railSam",
  "trainCarriage",
  "trainCarriageLoaded",
]);

export const BALLISTIC_KINDS: ReadonlySet<ModelKind> = new Set<ModelKind>([
  "artilleryShell",
  "rocket",
  "atomBomb",
  "hydrogenBomb",
  "mirv",
  "mirvWarhead",
  "shell",
]);

/** The model for a unit, or null for types the 3D view does not draw. */
export function modelKindFor(u: UnitLike): ModelKind | null {
  if (u.unitType === "Train") {
    // 0 = Engine, 1 = TailEngine, 2 = Carriage
    // An engine marked loaded is an express cargo train (see TrainExecution).
    if (u.trainType === 0 || u.trainType === 1) {
      return u.loaded ? "expressEngine" : "trainEngine";
    }
    return u.loaded ? "trainCarriageLoaded" : "trainCarriage";
  }
  return BY_TYPE[u.unitType] ?? null;
}

/** Peak altitude (tiles) of a ballistic flight covering `distance` tiles. */
export function arcPeak(kind: ModelKind, distance: number): number {
  if (kind === "shell") return Math.min(6, 1 + distance * 0.12);
  if (kind === "artilleryShell") return Math.min(16, 2 + distance * 0.3);
  if (kind === "rocket") return Math.max(8, distance * 0.2);
  return Math.max(14, distance * 0.32);
}

/**
 * Altitude and climb slope along a parabolic flight.
 * @param progress 0 at launch, 1 at impact
 * @returns height in tiles, and dHeight/dDistance (for pitching the model)
 */
export function arcAt(
  peak: number,
  distance: number,
  progress: number,
): { height: number; slope: number } {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const height = 4 * peak * p * (1 - p);
  const slope = distance > 0 ? (4 * peak * (1 - 2 * p)) / distance : 0;
  return { height, slope };
}

/**
 * Progress of a projectile from its origin towards its target, measured by
 * remaining distance so it reaches exactly 1 on impact even if the path
 * curves.
 */
export function flightProgress(
  ox: number,
  oy: number,
  x: number,
  y: number,
  tx: number,
  ty: number,
): { progress: number; distance: number } {
  const total = Math.hypot(tx - ox, ty - oy);
  if (total < 1e-6) return { progress: 1, distance: 0 };
  const remaining = Math.hypot(tx - x, ty - y);
  return {
    progress: Math.max(0, Math.min(1, 1 - remaining / total)),
    distance: total,
  };
}

/** Ground samples along a missile track, and the height kept above them. */
const CLEAR_SAMPLES = 24;
const CLEARANCE = 2.5;

/**
 * Pose of a ballistic missile (nuke, MIRV warhead, rocket): a clean arc on a
 * straight ground track from launch to target, whatever curve the
 * simulation's 2D path takes. Altitude is measured from the line between
 * the launch and target ground heights, never from the ground underneath,
 * so the missile does not bob over mountains.
 * @param groundAt ground height (tiles) at a point
 */
export function ballisticPose(
  kind: ModelKind,
  ox: number,
  oy: number,
  x: number,
  y: number,
  tx: number,
  ty: number,
  groundAt: (x: number, y: number) => number,
): { x: number; y: number; h: number; yaw: number; pitch: number } {
  const f = flightProgress(ox, oy, x, y, tx, ty);
  const p = f.progress;
  const gx = ox + (tx - ox) * p;
  const gy = oy + (ty - oy) * p;
  const g0 = Math.max(0, groundAt(ox, oy));
  const g1 = Math.max(0, groundAt(tx, ty));
  // Raise the arc until it clears every mountain along the track (the
  // same samples every frame, so the flight path never changes mid-air).
  let peak = arcPeak(kind, f.distance);
  for (let i = 1; i < CLEAR_SAMPLES; i++) {
    const s = i / CLEAR_SAMPLES;
    const ground = Math.max(
      0,
      groundAt(ox + (tx - ox) * s, oy + (ty - oy) * s),
    );
    const need =
      (ground + CLEARANCE - (g0 + (g1 - g0) * s)) / (4 * s * (1 - s));
    if (need > peak) peak = need;
  }
  const arc = arcAt(peak, f.distance, p);
  const base = g0 + (g1 - g0) * p;
  // Never below the ground under it (only matters right at launch/impact).
  const h = Math.max(
    base + arc.height + 0.5,
    Math.max(0, groundAt(gx, gy)) + 0.5,
  );
  const slope = arc.slope + (f.distance > 0 ? (g1 - g0) / f.distance : 0);
  const yaw =
    f.distance > 0
      ? Math.atan2(-(ty - oy), tx - ox)
      : Math.atan2(-(y - oy), x - ox);
  return { x: gx, y: gy, h, yaw, pitch: Math.atan(slope) };
}

/**
 * Buildings switch to flat 2D icons (like the classic 2D map) when the
 * camera is farther than ICON_MODE_ON, and back to 3D models when it comes
 * closer than ICON_MODE_OFF. The gap stops flicker at the threshold.
 */
export const ICON_MODE_ON = 220;
export const ICON_MODE_OFF = 180;

/** Whether buildings are drawn as 2D icons at this camera distance. */
export function nextIconMode(
  current: boolean,
  cameraDistance: number,
): boolean {
  if (current) return cameraDistance > ICON_MODE_OFF;
  return cameraDistance > ICON_MODE_ON;
}

/** Screen-readability multiplier: models grow as the camera pulls back. */
export function zoomScale(
  cameraDistance: number,
  base: number,
  max: number,
): number {
  return Math.max(1, Math.min(max, cameraDistance / base));
}

/** Stable small hash of a tile, for per-structure variation (yaw etc.). */
export function tileHash(ref: number): number {
  let h = ref | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Units that let their owner see enemy submarines nearby. */
const SUB_SPOTTERS = new Set([
  "Warship",
  "Destroyer",
  "Battleship",
  "Submarine",
  "Aircraft Carrier",
  "Port",
]);

/**
 * Enemy submarines the local player cannot see: those with no ship or port
 * of the player within `range` tiles. (Display only — the simulation is
 * shared; the engine has its own detection rule for ships.)
 */
export function hiddenSubmarines(
  units: Iterable<{
    id: number;
    unitType: string;
    ownerID: number;
    pos: number;
    isActive: boolean;
    level?: number;
  }>,
  mySmallID: number | null,
  mapWidth: number,
  range: number,
): Set<number> {
  const hidden = new Set<number>();
  if (mySmallID === null) return hidden;
  const subs: { id: number; x: number; y: number }[] = [];
  const spotters: { x: number; y: number; r2: number }[] = [];
  const r2 = range * range;
  for (const u of units) {
    if (!u.isActive) continue;
    const x = u.pos % mapWidth;
    const y = Math.floor(u.pos / mapWidth);
    if (u.ownerID === mySmallID) {
      if (SUB_SPOTTERS.has(u.unitType)) spotters.push({ x, y, r2 });
      else if (u.unitType === "Radar Station") {
        const r = radarRange(u.level ?? 1);
        spotters.push({ x, y, r2: r * r });
      }
    } else if (u.unitType === "Submarine" || u.unitType === "Sea Mine") {
      subs.push({ id: u.id, x, y });
    }
  }
  for (const s of subs) {
    let seen = false;
    for (const p of spotters) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      if (dx * dx + dy * dy <= p.r2) {
        seen = true;
        break;
      }
    }
    if (!seen) hidden.add(s.id);
  }
  return hidden;
}
