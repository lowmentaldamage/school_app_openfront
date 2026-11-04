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
import {
  atPowerTier,
  explosionFor,
  strikeTierFor,
  type ExplosionSpec,
} from "./ExplosionSpecs";
import {
  P_DUST,
  P_FIRE,
  P_FLASH,
  P_FOAM,
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
  /** Firing player's smallID (strike power tiers). */
  ownerSmallID?: number;
}

/** A player's weapon tiers (Mk 1-3) for sizing strike explosions. */
export interface StrikeTiers {
  artillery: number;
  naval: number;
  airstrike: number;
  rocket: number;
}

export interface EffectsBudget {
  particles: number;
  smoke: number;
  lights: boolean;
}

/** Battle spots spawned per tick along the front (scaled by density). */
const BATTLE_SPOTS_PER_TICK = 10;
/** Camera distance beyond which the front shows no battle effects. */
const BATTLE_MAX_DISTANCE = 260;

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
  onEvents(
    deadUnits: readonly DeadUnitEvent[],
    tiersOf: (smallID: number) => StrikeTiers | undefined = () => undefined,
  ): void {
    for (const d of deadUnits) {
      if ((d.tickAge ?? 0) > 2) continue;
      let spec = explosionFor(d.unitType, d.reachedTarget);
      if (spec === null) continue;
      const x = (d.pos % this.mapWidth) + 0.5;
      const z = Math.floor(d.pos / this.mapWidth) + 0.5;
      const tiers =
        d.ownerSmallID === undefined ? undefined : tiersOf(d.ownerSmallID);
      const tier = tiers === undefined ? 1 : strikeTierFor(d.unitType, tiers);
      spec = atPowerTier(spec, tier);
      this.explode(spec, x, z);
      if (tier >= 2) this.burn(x, z, spec.radius, tier);
    }
  }

  /**
   * Heavy (Mk II/III) hits leave the ground burning: flickering fire and a
   * column of smoke that lingers for several seconds after the blast.
   */
  burn(x: number, z: number, r: number, tier: number): void {
    const ground = Math.max(0, this.hf.sample(x, z));
    if (this.hf.sample(x, z) < 0) return; // nothing burns at sea
    const now = this.time;
    const last = tier >= 3 ? 9 : 5;
    const fires = Math.round((tier >= 3 ? 14 : 8) * this.density) + 2;
    for (let i = 0; i < fires; i++) {
      const fx = x + (Math.random() - 0.5) * r;
      const fz = z + (Math.random() - 0.5) * r;
      const at = now + 0.4 + Math.random() * last;
      this.fire.spawn(
        fx,
        ground + 0.15,
        fz,
        0,
        0.6,
        0,
        at,
        0.7,
        r * 0.35,
        P_FIRE,
      );
      this.smoke.spawn(
        fx,
        ground + 0.4,
        fz,
        (Math.random() - 0.5) * 0.3,
        0.8 + Math.random() * 0.6,
        (Math.random() - 0.5) * 0.3,
        at + 0.2,
        3.5 + Math.random() * 2,
        r * (0.5 + Math.random() * 0.4),
        P_SMOKE,
      );
    }
  }

  /**
   * Per tick: a small, clean battle along the front. Freshly captured land
   * tiles near the camera get rifle flashes, tracers, now and then a shell
   * burst, and a puff of smoke that drifts off. At most
   * BATTLE_SPOTS_PER_TICK spots (spread over the captured tiles), and
   * nothing when zoomed far out, where the tile flash in the terrain
   * shader already shows the capture.
   */
  battle(
    captured: readonly number[],
    /** Whether a changed tile was taken (now owned), not lost to nobody. */
    taken: (tile: number) => boolean,
    focusX: number,
    focusZ: number,
    viewRadius: number,
    cameraDistance: number,
  ): void {
    if (captured.length === 0 || cameraDistance > BATTLE_MAX_DISTANCE) return;
    const r2 = viewRadius * viewRadius;
    const spots = Math.max(
      1,
      Math.round(BATTLE_SPOTS_PER_TICK * Math.min(1, this.density)),
    );
    const stride = Math.max(1, Math.floor(captured.length / spots));
    const offset = Math.floor(Math.random() * stride);
    // Effects grow a little with distance so they stay visible, but stay
    // small next to buildings when zoomed in.
    const k = Math.min(2.2, Math.max(0.6, cameraDistance / 90));
    const now = this.time;
    let made = 0;
    for (let i = offset; i < captured.length && made < spots; i += stride) {
      const t = captured[i];
      if (!taken(t)) continue;
      const x = (t % this.mapWidth) + Math.random();
      const z = Math.floor(t / this.mapWidth) + Math.random();
      const dx = x - focusX;
      const dz = z - focusZ;
      if (dx * dx + dz * dz > r2) continue;
      const y = this.hf.sample(x, z);
      if (y <= 0) continue;
      made++;
      // Rifle flashes, a few staggered over half a second.
      for (let j = 0; j < 3; j++) {
        this.fire.spawn(
          x + (Math.random() - 0.5) * 0.8,
          y + 0.12,
          z + (Math.random() - 0.5) * 0.8,
          0,
          0,
          0,
          now + Math.random() * 0.5,
          0.09,
          0.45 * k,
          P_FLASH,
        );
      }
      // Tracers flying flat across the front.
      const a = Math.random() * Math.PI * 2;
      for (let j = 0; j < 2; j++) {
        const sp = 6 + Math.random() * 4;
        this.fire.spawn(
          x,
          y + 0.18,
          z,
          Math.cos(a) * sp,
          1.2,
          Math.sin(a) * sp,
          now + j * 0.15 + Math.random() * 0.2,
          0.3,
          0.16 * k,
          P_SPARK,
        );
      }
      // Now and then a shell lands: a small fireball and a dust ring.
      if (Math.random() < 0.22) {
        const bt = now + Math.random() * 0.6;
        this.fire.spawn(x, y + 0.2, z, 0, 0, 0, bt, 0.18, 1.6 * k, P_FLASH);
        this.fire.spawn(x, y + 0.2, z, 0, 1.5, 0, bt, 0.45, 0.9 * k, P_FIRE);
        for (let j = 0; j < 4; j++) {
          const da = (j / 4) * Math.PI * 2 + a;
          this.smoke.spawn(
            x,
            y + 0.05,
            z,
            Math.cos(da) * 1.4,
            0,
            Math.sin(da) * 1.4,
            bt,
            1.1,
            0.7 * k,
            P_DUST,
          );
        }
      }
      // Gun smoke drifting off.
      this.smoke.spawn(
        x,
        y + 0.25,
        z,
        (Math.random() - 0.5) * 0.4,
        0.2,
        (Math.random() - 0.5) * 0.4,
        now + Math.random() * 0.4,
        2.2,
        1.3 * k,
        P_SMOKE,
      );
    }
  }

  /**
   * Muzzle flash and a puff of gun smoke where a shell or rocket was fired
   * (rockets: a bigger blast-off cloud).
   */
  muzzle(shots: readonly { x: number; z: number; big: boolean }[]): void {
    const now = this.time;
    for (const s of shots.slice(0, 12)) {
      const g = Math.max(0, this.hf.sample(s.x, s.z));
      const k = s.big ? 2 : 1;
      this.fire.spawn(s.x, g + 0.5, s.z, 0, 0, 0, now, 0.1, 1.6 * k, P_FLASH);
      this.fire.spawn(s.x, g + 0.4, s.z, 0, 1.2, 0, now, 0.25, 0.7 * k, P_FIRE);
      for (let i = 0; i < 2 * k; i++) {
        this.smoke.spawn(
          s.x,
          g + 0.4,
          s.z,
          (Math.random() - 0.5) * 0.8 * k,
          0.4 + Math.random() * 0.4,
          (Math.random() - 0.5) * 0.8 * k,
          now + Math.random() * 0.1,
          1.6 + Math.random(),
          0.9 * k,
          s.big ? P_DUST : P_SMOKE,
        );
      }
    }
  }

  /**
   * White contrails behind aircraft: a short-lived puff every few frames
   * at each plane's tail, capped so a big raid stays cheap.
   */
  contrail(
    planes: readonly {
      x: number;
      y: number;
      z: number;
      yaw: number;
      scale: number;
      big: boolean;
    }[],
  ) {
    if (planes.length === 0) return;
    const now = this.time;
    const chance = Math.min(0.6, 16 / planes.length) * this.density;
    for (const p of planes) {
      if (Math.random() > chance) continue;
      // Behind the tail, from the wing engines (bombers) or the nose.
      const back = (p.big ? 1.1 : 0.7) * p.scale;
      const side = p.big ? 0.55 * p.scale * (Math.random() < 0.5 ? -1 : 1) : 0;
      this.smoke.spawn(
        p.x - Math.cos(p.yaw) * back + Math.sin(p.yaw) * side,
        p.y,
        p.z + Math.sin(p.yaw) * back + Math.cos(p.yaw) * side,
        0,
        0,
        0,
        now,
        p.big ? 1.6 : 1.1,
        (p.big ? 0.3 : 0.2) * p.scale,
        P_FOAM,
      );
    }
  }

  /**
   * Natural disasters (cosmetic; the losses come from the simulation).
   * "warning": signs during the 10 s warning (smoke rising from the
   * volcano, dust, gathering clouds, receding sea); "strike": the event
   * itself. Particles are born over time (future birth), so one call
   * plays the whole sequence. Counts are bounded so the shared buffers
   * never flood.
   */
  disaster(
    kind: string,
    phase: "warning" | "strike",
    x: number,
    z: number,
    r: number,
  ): void {
    const now = this.time;
    const g = Math.max(0, this.hf.sample(x, z));
    const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;
    const k = Math.max(0.5, this.density);
    if (phase === "warning") {
      const n = Math.round(24 * k);
      for (let i = 0; i < n; i++) {
        const at = now + (i / n) * 9;
        if (kind === "volcano") {
          this.smoke.spawn(
            x + rnd(0.6),
            g + 0.5,
            z + rnd(0.6),
            rnd(0.2),
            1.6,
            rnd(0.2),
            at,
            4,
            2.4,
            P_SMOKE,
          );
        } else if (kind === "storm") {
          this.smoke.spawn(
            x + rnd(r),
            g + 14,
            z + rnd(r),
            rnd(0.5),
            0,
            rnd(0.5),
            at,
            6,
            r * 0.35,
            P_SMOKE,
          );
        } else if (kind === "tsunami") {
          this.smoke.spawn(
            x + rnd(r * 0.6),
            0.1,
            z + rnd(r * 0.6),
            rnd(1),
            0,
            rnd(1),
            at,
            2.5,
            1.4,
            P_FOAM,
          );
        } else {
          const px = x + rnd(r * 0.7);
          const pz = z + rnd(r * 0.7);
          const pg = Math.max(0, this.hf.sample(px, pz));
          this.smoke.spawn(
            px,
            pg + 0.2,
            pz,
            rnd(0.6),
            0.2,
            rnd(0.6),
            at,
            2.2,
            1.6,
            kind === "wildfire" ? P_SMOKE : P_DUST,
          );
        }
      }
      return;
    }

    switch (kind) {
      case "volcano": {
        this.explode(
          { kind: "building", radius: r * 0.45, altitude: 0, intensity: 2.5 },
          x,
          z,
        );
        // Lava fountains and bombs for ~15 s, an ash column for ~30 s.
        for (let i = 0; i < Math.round(70 * k); i++) {
          const at = now + Math.random() * 15;
          this.fire.spawn(
            x + rnd(0.8),
            g + 1,
            z + rnd(0.8),
            rnd(3),
            6 + Math.random() * 8,
            rnd(3),
            at,
            1.4,
            1.2 + Math.random(),
            P_FIRE,
          );
          if (i % 3 === 0) {
            this.fire.spawn(
              x,
              g + 1.5,
              z,
              rnd(5),
              7 + Math.random() * 6,
              rnd(5),
              at,
              2.2,
              0.5,
              P_SPARK,
            );
          }
        }
        for (let i = 0; i < Math.round(40 * k); i++) {
          const at = now + Math.random() * 30;
          this.smoke.spawn(
            x + rnd(1),
            g + 3,
            z + rnd(1),
            rnd(0.6),
            2.2 + Math.random(),
            rnd(0.6),
            at,
            8,
            4 + Math.random() * 3,
            P_SMOKE,
          );
        }
        // Lava flows burn the slopes.
        for (let i = 0; i < 6; i++) {
          this.burn(x + rnd(r * 0.4), z + rnd(r * 0.4), r * 0.35, 3);
        }
        this.shake(1.2, 3500);
        break;
      }
      case "earthquake": {
        for (let w = 0; w < 3; w++) {
          this.rings.spawn(x, g, z, r * (0.6 + w * 0.25), 1.6, now + w * 0.6);
        }
        for (let i = 0; i < Math.round(60 * k); i++) {
          const px = x + rnd(r);
          const pz = z + rnd(r);
          const pg = Math.max(0, this.hf.sample(px, pz));
          this.smoke.spawn(
            px,
            pg + 0.1,
            pz,
            rnd(1.5),
            0.3,
            rnd(1.5),
            now + Math.random() * 3,
            3,
            1.8,
            P_DUST,
          );
        }
        this.shake(0.9, 4000);
        break;
      }
      case "tsunami": {
        for (let w = 0; w < 3; w++) {
          this.rings.spawn(x, 0.2, z, r * (0.8 + w * 0.2), 2.4, now + w * 0.8);
        }
        for (let i = 0; i < Math.round(90 * k); i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * r;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          const pg = Math.max(0, this.hf.sample(px, pz));
          this.smoke.spawn(
            px,
            pg + 0.3,
            pz,
            Math.cos(a) * 2.5,
            1.5 + Math.random() * 2,
            Math.sin(a) * 2.5,
            now + (d / r) * 2.5,
            2.4,
            2,
            P_FOAM,
          );
        }
        this.shake(0.4, 2000);
        break;
      }
      case "storm": {
        // Black clouds, lightning and white water for ~12 s.
        for (let i = 0; i < Math.round(30 * k); i++) {
          this.smoke.spawn(
            x + rnd(r),
            g + 14 + rnd(2),
            z + rnd(r),
            rnd(0.8),
            0,
            rnd(0.8),
            now + Math.random() * 10,
            7,
            r * 0.4,
            P_SMOKE,
          );
        }
        for (let i = 0; i < Math.round(14 * k); i++) {
          const at = now + Math.random() * 12;
          const px = x + rnd(r * 0.8);
          const pz = z + rnd(r * 0.8);
          this.fire.spawn(px, 13, pz, 0, 0, 0, at, 0.12, 9, P_FLASH);
          this.fire.spawn(px, 0.5, pz, 0, 0, 0, at, 0.1, 4, P_FLASH);
        }
        for (let i = 0; i < Math.round(60 * k); i++) {
          this.smoke.spawn(
            x + rnd(r),
            0.1,
            z + rnd(r),
            rnd(2),
            0.4,
            rnd(2),
            now + Math.random() * 12,
            1.8,
            1.5,
            P_FOAM,
          );
        }
        break;
      }
      case "wildfire": {
        // A front that spreads out from the centre over ~12 s.
        for (let i = 0; i < Math.round(80 * k); i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * r;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          const pg = Math.max(0, this.hf.sample(px, pz));
          if (this.hf.sample(px, pz) < 0) continue;
          const at = now + (d / r) * 10 + Math.random();
          this.fire.spawn(px, pg + 0.2, pz, 0, 0.8, 0, at, 1.6, 1.4, P_FIRE);
          if (i % 2 === 0) {
            this.smoke.spawn(
              px,
              pg + 0.8,
              pz,
              rnd(0.4),
              1.2,
              rnd(0.4),
              at + 0.3,
              5,
              2.4,
              P_SMOKE,
            );
          }
        }
        break;
      }
    }
  }

  /** Set by WorldRenderer: shakes the camera (earthquakes, eruptions). */
  shake: (amount: number, ms: number) => void = () => {};

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
    // Ground blasts kick up a ring of dust that rolls outward; blasts on
    // water throw up white spray instead.
    if (spec.altitude <= 0.5) {
      const water = this.hf.sample(x, z) < 0;
      const dustCount = Math.round((spec.kind === "nuke" ? 36 : 10) * k) + 2;
      for (let i = 0; i < dustCount; i++) {
        const a = (i / dustCount) * Math.PI * 2 + Math.random() * 0.4;
        const speed = r * (1.4 + Math.random() * 1.2);
        this.smoke.spawn(
          x,
          ground + 0.2,
          z,
          Math.cos(a) * speed,
          water ? 2 + Math.random() * 3 : 0.3,
          Math.sin(a) * speed,
          now + Math.random() * 0.1,
          water ? 1.2 + Math.random() : 2 + Math.random() * 1.5,
          r * (water ? 0.5 : 0.7),
          water ? P_FOAM : P_DUST,
        );
      }
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

  /**
   * Foam behind moving ships: call per frame with each ship's position,
   * heading (radians) and size; emits a little white water at the stern.
   */
  wake(ships: readonly { x: number; z: number; yaw: number; scale: number }[]) {
    const now = this.time;
    // A fleet must not flood the shared smoke buffer (explosions use it).
    let budget = 24;
    const chance =
      Math.min(0.35, 24 / Math.max(1, ships.length)) * this.density;
    for (const s of ships) {
      if (budget <= 0) break;
      if (Math.random() > chance) continue;
      budget--;
      const back = 1.2 * s.scale;
      const cx = s.x - Math.cos(s.yaw) * back;
      const cz = s.z + Math.sin(s.yaw) * back;
      const side = (Math.random() - 0.5) * 0.6;
      this.smoke.spawn(
        cx + Math.sin(s.yaw) * side * s.scale,
        0.05,
        cz + Math.cos(s.yaw) * side * s.scale,
        Math.sin(s.yaw) * side * 2,
        0,
        Math.cos(s.yaw) * side * 2,
        now,
        1.6 + Math.random() * 0.8,
        0.5 * s.scale,
        P_FOAM,
      );
    }
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
