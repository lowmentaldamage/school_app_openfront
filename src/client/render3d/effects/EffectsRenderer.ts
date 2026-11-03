/**
 * EffectsRenderer — cinematic explosions driven by simulation events.
 *
 * Reads FrameData.events.deadUnits each tick (never writes game state) and
 * turns them into fireballs, sparks, smoke columns, nuke mushroom clouds,
 * shockwave rings and a short light flash. Everything is pooled:
 *   - fire/sparks/flash: one additive particle ring buffer,
 *   - smoke: one alpha-blended particle ring buffer,
 *   - rings: one instanced mesh,
 *   - flash: two point lights reused round-robin (fixed light count, so no
 *     shader recompiles; disabled on mobile).
 */

import { Group, PointLight } from "three";
import type { Heightfield } from "../terrain/Heightfield";
import { explosionFor, type ExplosionSpec } from "./ExplosionSpecs";
import {
  P_FIRE,
  P_FLASH,
  P_SMOKE,
  P_SPARK,
  ParticleSystem,
} from "./ParticleSystem";
import { ShockwaveRings } from "./ShockwaveRings";

export interface DeadUnitEvent {
  unitType: string;
  pos: number;
  reachedTarget: boolean;
  /** Ticks since it happened; old events (seek/replay) are skipped. */
  tickAge?: number;
}

export interface EffectsBudget {
  particles: number;
  smoke: number;
  lights: boolean;
}

export class EffectsRenderer {
  readonly group = new Group();
  private readonly fire: ParticleSystem;
  private readonly smoke: ParticleSystem;
  private readonly rings = new ShockwaveRings();
  private readonly lights: PointLight[] = [];
  private readonly lightEnd: number[] = [];
  private nextLight = 0;
  private time = 0;
  /** Scales particle counts (adaptive quality). */
  density = 1;

  constructor(
    private readonly hf: Heightfield,
    private readonly mapWidth: number,
    budget: EffectsBudget,
  ) {
    this.group.name = "effects";
    this.fire = ParticleSystem.additive(budget.particles);
    this.smoke = ParticleSystem.normal(budget.smoke);
    this.group.add(this.smoke.points, this.fire.points, this.rings.mesh);
    if (budget.lights) {
      for (let i = 0; i < 2; i++) {
        const l = new PointLight(0xffaa55, 0, 60, 1.6);
        this.lights.push(l);
        this.lightEnd.push(0);
        this.group.add(l);
      }
    }
  }

  /** Per tick: spawn effects for units that died this tick. */
  onEvents(deadUnits: readonly DeadUnitEvent[]): void {
    for (const d of deadUnits) {
      if ((d.tickAge ?? 0) > 2) continue;
      const spec = explosionFor(d.unitType, d.reachedTarget);
      if (spec === null) continue;
      const x = (d.pos % this.mapWidth) + 0.5;
      const z = Math.floor(d.pos / this.mapWidth) + 0.5;
      this.explode(spec, x, z);
    }
  }

  /** Spawn an explosion at a tile position (x, z = tile x, y). */
  explode(spec: ExplosionSpec, x: number, z: number): void {
    const ground = Math.max(0, this.hf.sample(x, z));
    const y = ground + spec.altitude;
    const now = this.time;
    const r = spec.radius;
    const k = this.density * spec.intensity;

    // Flash
    this.fire.spawn(x, y + r * 0.3, z, 0, 0, 0, now, 0.25, r * 3.2, P_FLASH);
    // Fireball
    const fireCount = Math.round((spec.kind === "nuke" ? 60 : 18) * k) + 4;
    for (let i = 0; i < fireCount; i++) {
      // Air bursts expand as a sphere; ground blasts as a hemisphere.
      const [dx, dy, dz] = randDir(spec.altitude > 0 ? -1 : 0.15);
      const speed = r * (1.2 + Math.random() * 1.6);
      this.fire.spawn(
        x + dx * r * 0.15,
        y + dy * r * 0.2,
        z + dz * r * 0.15,
        dx * speed,
        dy * speed + (spec.altitude > 0 ? 0 : r * 0.4),
        dz * speed,
        now + Math.random() * 0.08,
        0.7 + Math.random() * 0.8,
        r * (0.55 + Math.random() * 0.5),
        P_FIRE,
      );
    }
    // Sparks / debris
    const sparkCount = Math.round((spec.kind === "nuke" ? 40 : 16) * k);
    for (let i = 0; i < sparkCount; i++) {
      const [dx, dy, dz] = randDir(0.3);
      const speed = 4 + Math.random() * 6 + r * 0.8;
      this.fire.spawn(
        x,
        y + 0.2,
        z,
        dx * speed,
        Math.abs(dy) * speed + 3,
        dz * speed,
        now,
        0.6 + Math.random() * 0.7,
        0.25 + r * 0.04,
        P_SPARK,
      );
    }
    // Smoke
    const smokeCount = Math.round((spec.kind === "nuke" ? 70 : 14) * k) + 3;
    for (let i = 0; i < smokeCount; i++) {
      const [dx, , dz] = randDir(0);
      const speed = r * (0.3 + Math.random() * 0.6);
      this.smoke.spawn(
        x + dx * r * 0.3,
        y + Math.random() * r * 0.3,
        z + dz * r * 0.3,
        dx * speed,
        0.5 + Math.random() * 1.5,
        dz * speed,
        now + 0.1 + Math.random() * 0.4,
        2.5 + Math.random() * 2.5,
        r * (0.6 + Math.random() * 0.6),
        P_SMOKE,
      );
    }
    if (spec.kind === "nuke") this.mushroom(x, ground, z, r, now, k);
    if (
      spec.kind === "nuke" ||
      spec.kind === "building" ||
      spec.kind === "shellHit" ||
      spec.kind === "ship"
    ) {
      this.rings.spawn(
        x,
        ground,
        z,
        r * (spec.kind === "nuke" ? 2.4 : 1.6),
        spec.kind === "nuke" ? 2.2 : 0.9,
        now,
      );
    }
    this.flashLight(x, y + r * 0.5, z, r, now);
  }

  /** Per frame. */
  update(timeSeconds: number, pixelScale: number): void {
    this.time = timeSeconds;
    this.fire.update(timeSeconds, pixelScale);
    this.smoke.update(timeSeconds, pixelScale);
    this.rings.update(timeSeconds);
    for (let i = 0; i < this.lights.length; i++) {
      const left = this.lightEnd[i] - timeSeconds;
      this.lights[i].intensity =
        left > 0 ? this.lights[i].userData.peak * (left / 0.6) : 0;
    }
  }

  dispose(): void {
    this.fire.dispose();
    this.smoke.dispose();
    this.rings.dispose();
    for (const l of this.lights) l.dispose();
  }

  private mushroom(
    x: number,
    ground: number,
    z: number,
    r: number,
    now: number,
    k: number,
  ): void {
    const height = r * 2.2;
    const stem = Math.round(50 * k) + 10;
    for (let i = 0; i < stem; i++) {
      const f = i / stem;
      const [dx, , dz] = randDir(0);
      this.smoke.spawn(
        x + dx * r * 0.12,
        ground + f * height * 0.4,
        z + dz * r * 0.12,
        dx * 0.4,
        height * (0.25 + f * 0.25),
        dz * 0.4,
        now + 0.2 + f * 0.6,
        6 + Math.random() * 3,
        r * (0.35 + f * 0.25),
        P_SMOKE,
      );
    }
    const cap = Math.round(60 * k) + 12;
    for (let i = 0; i < cap; i++) {
      const [dx, dy, dz] = randDir(0.4);
      this.smoke.spawn(
        x + dx * r * 0.3,
        ground + height * 0.7 + dy * r * 0.3,
        z + dz * r * 0.3,
        dx * r * 0.9,
        height * 0.18,
        dz * r * 0.9,
        now + 0.5 + Math.random() * 0.4,
        7 + Math.random() * 3,
        r * (0.7 + Math.random() * 0.5),
        P_SMOKE,
      );
      if (i % 3 === 0) {
        this.fire.spawn(
          x + dx * r * 0.3,
          ground + height * 0.7,
          z + dz * r * 0.3,
          dx * r * 0.7,
          height * 0.2,
          dz * r * 0.7,
          now + 0.4,
          1.6 + Math.random(),
          r * 0.6,
          P_FIRE,
        );
      }
    }
  }

  private flashLight(
    x: number,
    y: number,
    z: number,
    r: number,
    now: number,
  ): void {
    if (this.lights.length === 0) return;
    const i = this.nextLight;
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    const l = this.lights[i];
    l.position.set(x, y, z);
    l.distance = r * 8;
    l.userData.peak = Math.min(400, 30 * r);
    this.lightEnd[i] = now + 0.6;
  }
}

function randDir(minUp: number): [number, number, number] {
  const a = Math.random() * Math.PI * 2;
  const u = minUp + Math.random() * (1 - minUp);
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return [Math.cos(a) * s, u, Math.sin(a) * s];
}
