/**
 * Motion — small, GPU-free helpers that make units move like vehicles
 * instead of sliding counters: limited turn rates, ships heeling and
 * planes banking in turns, aircraft climbing out of (and descending into)
 * their base, and buildings rising when they are finished.
 *
 * Visual only: the simulation position is never changed, only the pose.
 */

import type { ModelKind } from "./UnitModels";

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  a %= TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a <= -Math.PI) a += TWO_PI;
  return a;
}

/** Turn `current` toward `target` by at most `maxStep` radians. */
export function turnToward(
  current: number,
  target: number,
  maxStep: number,
): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return wrapAngle(current + Math.sign(d) * maxStep);
}

/** Maximum turn rate (radians per second) by kind. */
export function turnRate(kind: ModelKind): number {
  switch (kind) {
    case "battleship":
    case "carrier":
      return 1.6;
    case "warship":
    case "submarine":
    case "tradeShip":
    case "transport":
      return 2.4;
    case "destroyer":
      return 3.4;
    case "bomber":
      return 2.2;
    case "fighter":
      return 4.5;
    default:
      return 14; // trains follow the rails closely
  }
}

/**
 * Roll angle for a turn at `yawRate` rad/s. Planes bank into the turn;
 * ships heel gently outwards. Clamped so nothing flips over.
 */
export function bankFor(air: boolean, yawRate: number): number {
  if (air) return clamp(-yawRate * 0.45, -0.75, 0.75);
  return clamp(yawRate * 0.12, -0.18, 0.18);
}

/** Ease `current` toward `target` with time constant `tau` seconds. */
export function smoothTo(
  current: number,
  target: number,
  dtSec: number,
  tau: number,
): number {
  if (dtSec <= 0) return current;
  const k = 1 - Math.exp(-dtSec / tau);
  return current + (target - current) * k;
}

/**
 * Aircraft height above ground: they take off from their base, climb to
 * cruise over the first tiles and descend again when they come home
 * (distance measured from where the plane was first seen).
 */
export function airAltitude(distFromBase: number, cruise: number): number {
  const climb = smoothstep(0, 7, distFromBase);
  return 0.4 + (cruise - 0.4) * climb;
}

/** Pitch of the climb at `distFromBase` (radians, nose up positive). */
export function airClimbPitch(
  distFromBase: number,
  cruise: number,
  outbound: boolean,
): number {
  if (distFromBase >= 7) return 0;
  const t = distFromBase / 7;
  const slope = (cruise - 0.4) * 6 * t * (1 - t) * (1 / 7);
  return Math.atan(slope) * (outbound ? 1 : -1);
}

/** Duration of the "building rises" animation. */
export const BUILD_RISE_MS = 650;

/**
 * Height factor of a building `ageMs` after it appeared or was finished:
 * rises from the ground with a small overshoot, then settles at 1.
 */
export function buildRise(ageMs: number): number {
  if (ageMs >= BUILD_RISE_MS) return 1;
  if (ageMs <= 0) return 0.05;
  const t = ageMs / BUILD_RISE_MS;
  // easeOutBack
  const c1 = 1.4;
  const c3 = c1 + 1;
  const u = t - 1;
  return Math.max(0.05, 1 + c3 * u * u * u + c1 * u * u);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
