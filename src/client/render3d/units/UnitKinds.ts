/**
 * Pure helpers for the 3D unit layer: which model a simulation unit uses,
 * and the flight-path maths for missiles and shells. No three.js imports,
 * so this is unit tested directly.
 */

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
  }>,
  mySmallID: number | null,
  mapWidth: number,
  range: number,
): Set<number> {
  const hidden = new Set<number>();
  if (mySmallID === null) return hidden;
  const subs: { id: number; x: number; y: number }[] = [];
  const spotters: { x: number; y: number }[] = [];
  for (const u of units) {
    if (!u.isActive) continue;
    const x = u.pos % mapWidth;
    const y = Math.floor(u.pos / mapWidth);
    if (u.ownerID === mySmallID) {
      if (SUB_SPOTTERS.has(u.unitType)) spotters.push({ x, y });
    } else if (u.unitType === "Submarine") {
      subs.push({ id: u.id, x, y });
    }
  }
  const r2 = range * range;
  for (const s of subs) {
    let seen = false;
    for (const p of spotters) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      if (dx * dx + dy * dy <= r2) {
        seen = true;
        break;
      }
    }
    if (!seen) hidden.add(s.id);
  }
  return hidden;
}
