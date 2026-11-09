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
  P_DEBRIS,
  P_DUST,
  P_FIRE,
  P_FLASH,
  P_SCORCH,
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
      if (
        !d.reachedTarget &&
        (d.unitType === "Bomber" || d.unitType === "Fighter")
      ) {
        this.planeCrash(x, z, spec.altitude);
      }
    }
  }

  /**
   * A plane shot down: a burning wreck falls trailing black smoke and hits
   * the ground a little further on with a small blast.
   */
  planeCrash(x: number, z: number, altitude: number): void {
    const now = this.time;
    const ground = Math.max(0, this.hf.sample(x, z));
    const dir = Math.random() * Math.PI * 2;
    const fall = 2.2;
    const steps = Math.round(14 * Math.max(0.5, this.density));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const px = x + Math.cos(dir) * f * 6;
      const pz = z + Math.sin(dir) * f * 6;
      const h = ground + altitude * (1 - f * f);
      const at = now + f * fall;
      this.smoke.spawn(px, h, pz, 0, 0.3, 0, at, 3, 0.9 + f, P_SMOKE);
      if (i % 2 === 0)
        this.fire.spawn(px, h, pz, 0, 0, 0, at, 0.4, 0.7, P_FIRE);
    }
    const ex = x + Math.cos(dir) * 6;
    const ez = z + Math.sin(dir) * 6;
    const eg = Math.max(0, this.hf.sample(ex, ez));
    this.fire.spawn(ex, eg + 0.5, ez, 0, 0, 0, now + fall, 0.25, 3, P_FLASH);
    for (let i = 0; i < 6; i++) {
      this.smoke.spawn(
        ex + (Math.random() - 0.5),
        eg + 0.3,
        ez + (Math.random() - 0.5),
        (Math.random() - 0.5) * 0.4,
        1,
        (Math.random() - 0.5) * 0.4,
        now + fall + 0.1,
        4,
        1.6,
        P_SMOKE,
      );
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
  /** Shell tracers: a short-lived glowing dot behind each shell in flight. */
  tracers(shells: readonly { x: number; y: number; z: number }[]): void {
    if (shells.length === 0) return;
    const now = this.time;
    const chance = Math.min(1, 40 / shells.length) * this.density;
    for (const sh of shells) {
      if (Math.random() > chance) continue;
      this.fire.spawn(sh.x, sh.y, sh.z, 0, 0, 0, now, 0.18, 0.35, P_FIRE);
    }
  }

  /**
   * Flak: a quick flash and a puff of dark smoke at a random spot around a
   * plane, and a faint tracer climbing from the gun.
   */
  flak(
    bursts: readonly {
      x: number;
      y: number;
      z: number;
      ax: number;
      az: number;
    }[],
  ): void {
    const now = this.time;
    for (const b of bursts) {
      const px = b.x + (Math.random() - 0.5) * 3;
      const py = b.y + (Math.random() - 0.3) * 2;
      const pz = b.z + (Math.random() - 0.5) * 3;
      this.fire.spawn(px, py, pz, 0, 0, 0, now, 0.12, 1.4, P_FLASH);
      this.smoke.spawn(px, py, pz, 0, 0.1, 0, now + 0.05, 2.2, 1.1, P_SMOKE);
      const g = Math.max(0, this.hf.sample(b.ax, b.az)) + 0.6;
      this.fire.spawn(
        b.ax,
        g,
        b.az,
        (px - b.ax) * 2.5,
        (py - g) * 2.5,
        (pz - b.az) * 2.5,
        now,
        0.35,
        0.25,
        P_SPARK,
      );
    }
  }

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
            r * 0.22,
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
        // A Plinian eruption: a short blast at the crater, then for ~30 s
        // an ash column that climbs high and spreads into a flat cloud,
        // lava fountains and bombs, glowing lava running down the slopes
        // and a grey ash flow rolling along the ground.
        // Everything starts above the crater rim (the highest ground
        // around the vent), never inside the cone.
        let rim: number = g;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          rim = Math.max(
            rim,
            this.hf.sample(x + Math.cos(ang) * 1.5, z + Math.sin(ang) * 1.5),
          );
        }
        const vent = rim + 0.8;
        this.fire.spawn(x, vent + 0.7, z, 0, 0, 0, now, 0.3, r * 0.9, P_FLASH);
        const top = vent + 18 + r * 0.6;
        for (let i = 0; i < Math.round(70 * k); i++) {
          const at = now + Math.random() * 28;
          // Column: fast and narrow near the vent, wider as it climbs.
          const rise = 5 + Math.random() * 3;
          this.smoke.spawn(
            x + rnd(0.7),
            vent + 1.5 + Math.random() * 2,
            z + rnd(0.7),
            rnd(0.5),
            rise,
            rnd(0.5),
            at,
            (top - vent) / rise + 2,
            2.2 + Math.random() * 2,
            P_SMOKE,
          );
          // Umbrella: ash spreading sideways at the top of the column.
          if (i % 2 === 0) {
            const a = Math.random() * Math.PI * 2;
            const v = 1.2 + Math.random() * 1.8;
            this.smoke.spawn(
              x + rnd(1.5),
              top + rnd(1.5),
              z + rnd(1.5),
              Math.cos(a) * v * r * 0.25,
              -0.4,
              Math.sin(a) * v * r * 0.25,
              at + 2.5,
              14,
              5 + Math.random() * 4,
              P_SMOKE,
            );
          }
        }
        // Lava fountain and bombs (sparks fall back with gravity).
        for (let i = 0; i < Math.round(60 * k); i++) {
          const at = now + Math.random() * 16;
          this.fire.spawn(
            x + rnd(0.5),
            vent + 1,
            z + rnd(0.5),
            rnd(1.5),
            5 + Math.random() * 6,
            rnd(1.5),
            at,
            1.1,
            0.9 + Math.random() * 0.8,
            P_FIRE,
          );
          if (i % 2 === 0) {
            this.fire.spawn(
              x,
              vent + 1.5,
              z,
              rnd(4),
              8 + Math.random() * 6,
              rnd(4),
              at,
              2.6,
              0.45,
              P_SPARK,
            );
          }
        }
        // Lava flows: a few glowing tongues creeping downhill, leaving
        // burnt ground.
        const flows = 4;
        for (let f = 0; f < flows; f++) {
          const a = (f / flows) * Math.PI * 2 + Math.random();
          const len = r * (0.45 + Math.random() * 0.3);
          const steps = Math.round(16 * k) + 4;
          for (let j = 0; j < steps; j++) {
            const d = (j / steps) * len;
            const wob = Math.sin(j * 0.9 + f) * 0.6;
            const px = x + Math.cos(a) * d - Math.sin(a) * wob;
            const pz = z + Math.sin(a) * d + Math.cos(a) * wob;
            const pg = Math.max(0, this.hf.sample(px, pz));
            const at = now + 1.5 + (j / steps) * 14;
            this.fire.spawn(px, pg + 0.12, pz, 0, 0.15, 0, at, 6, 0.9, P_FIRE);
            this.smoke.spawn(px, pg, pz, 0, 0, 0, at, 30, 1.6, P_SCORCH);
            if (j % 3 === 0) {
              this.smoke.spawn(
                px,
                pg + 0.3,
                pz,
                rnd(0.2),
                0.7,
                rnd(0.2),
                at + 1,
                5,
                1.6,
                P_SMOKE,
              );
            }
          }
        }
        // Pyroclastic flow: grey ash rolling out along the ground.
        for (let i = 0; i < Math.round(36 * k); i++) {
          const a = Math.random() * Math.PI * 2;
          const v = r * (0.25 + Math.random() * 0.25);
          this.smoke.spawn(
            x + Math.cos(a),
            vent + 0.5,
            z + Math.sin(a),
            Math.cos(a) * v,
            0.2,
            Math.sin(a) * v,
            now + 0.8 + Math.random() * 2,
            5,
            2.4 + Math.random() * 1.5,
            P_DUST,
          );
        }
        this.shake(1.2, 3500);
        break;
      }
      case "earthquake": {
        // The ground ruptures along a fault: a jagged crack opens across
        // the area, dust bursts out of it, rubble falls, and the shaking
        // comes back as aftershocks.
        const a = Math.random() * Math.PI;
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        const steps = Math.round(28 * k) + 8;
        let off = 0;
        for (let j = 0; j <= steps; j++) {
          const d = (j / steps - 0.5) * 2 * r * 0.9;
          off += rnd(0.5);
          off *= 0.85;
          const px = x + ux * d - uz * off;
          const pz = z + uz * d + ux * off;
          const pg = Math.max(0, this.hf.sample(px, pz));
          // Opens from the epicentre outwards.
          const at = now + (Math.abs(d) / r) * 1.2;
          this.smoke.spawn(px, pg, pz, 0, 0, 0, at, 35, 0.9, P_SCORCH);
          this.smoke.spawn(
            px,
            pg + 0.1,
            pz,
            rnd(0.8),
            0.6,
            rnd(0.8),
            at,
            3.5,
            1.6,
            P_DUST,
          );
          if (j % 3 === 0) {
            this.smoke.spawn(
              px,
              pg + 0.2,
              pz,
              rnd(1.5),
              1.5 + Math.random() * 1.5,
              rnd(1.5),
              at,
              1.4,
              0.08,
              P_DEBRIS,
            );
          }
        }
        for (let w = 0; w < 3; w++) {
          this.rings.spawn(x, g, z, r * (0.6 + w * 0.25), 1.6, now + w * 0.6);
        }
        // Dust shaken up across the whole area (buildings, slopes).
        for (let i = 0; i < Math.round(40 * k); i++) {
          const px = x + rnd(r);
          const pz = z + rnd(r);
          const pg = Math.max(0, this.hf.sample(px, pz));
          this.smoke.spawn(
            px,
            pg + 0.1,
            pz,
            rnd(1.2),
            0.25,
            rnd(1.2),
            now + Math.random() * 3,
            3,
            1.6,
            P_DUST,
          );
        }
        this.shake(1.0, 4000);
        // Aftershocks.
        setTimeout(() => this.shake(0.45, 1500), 5500);
        setTimeout(() => this.shake(0.3, 1200), 9000);
        break;
      }
      case "tsunami": {
        // The wave: a continuous white crest racing outwards from the
        // epicentre, throwing spray up as it breaks on the coast.
        const crests = Math.round(150 * k);
        for (let i = 0; i < crests; i++) {
          const a = (i / crests) * Math.PI * 2 + rnd(0.02);
          const d = r * (0.15 + Math.random() * 0.85);
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          const ground = this.hf.sample(px, pz);
          const at = now + (d / r) * 3;
          const onLand = ground > 0;
          this.smoke.spawn(
            px,
            Math.max(0, ground) + 0.2,
            pz,
            Math.cos(a) * (onLand ? 1.2 : 3),
            onLand ? 2.5 + Math.random() * 2 : 0.6,
            Math.sin(a) * (onLand ? 1.2 : 3),
            at,
            onLand ? 2.8 : 1.8,
            onLand ? 2.2 : 1.4,
            P_FOAM,
          );
        }
        for (let w = 0; w < 4; w++) {
          this.rings.spawn(x, 0.2, z, r * (0.7 + w * 0.15), 2.8, now + w * 0.5);
        }
        this.shake(0.4, 2000);
        break;
      }
      case "storm": {
        // Black clouds, lightning and white water for ~12 s.
        for (let i = 0; i < Math.round(45 * k); i++) {
          this.smoke.spawn(
            x + rnd(r),
            g + 14 + rnd(2),
            z + rnd(r),
            rnd(0.8),
            0,
            rnd(0.8),
            now + Math.random() * 10,
            7,
            r * 0.24,
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
        // A fire front spreading out over ~12 s, pushed by the wind: tall
        // flames at the front, embers flying ahead, smoke leaning
        // downwind, burnt black ground left behind.
        const wind = Math.random() * Math.PI * 2;
        const wx = Math.cos(wind);
        const wz = Math.sin(wind);
        for (let i = 0; i < Math.round(90 * k); i++) {
          const a = Math.random() * Math.PI * 2;
          // Spreads further downwind.
          const reach = 0.65 + 0.35 * (Math.cos(a - wind) + 1) * 0.5;
          const d = Math.random() * r * reach;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          if (this.hf.sample(px, pz) < 0) continue;
          const pg = Math.max(0, this.hf.sample(px, pz));
          const at = now + (d / r) * 10 + Math.random();
          this.fire.spawn(
            px,
            pg + 0.2,
            pz,
            wx * 0.3,
            1,
            wz * 0.3,
            at,
            2,
            1.5,
            P_FIRE,
          );
          this.smoke.spawn(px, pg, pz, 0, 0, 0, at + 1, 40, 1.8, P_SCORCH);
          if (i % 2 === 0) {
            this.smoke.spawn(
              px,
              pg + 0.8,
              pz,
              wx * 1.4 + rnd(0.3),
              1.3,
              wz * 1.4 + rnd(0.3),
              at + 0.3,
              6,
              2.6,
              P_SMOKE,
            );
          }
          if (i % 4 === 0) {
            this.fire.spawn(
              px,
              pg + 0.8,
              pz,
              wx * 3 + rnd(1),
              3 + Math.random() * 2,
              wz * 3 + rnd(1),
              at,
              1.8,
              0.3,
              P_SPARK,
            );
          }
        }
        break;
      }
    }
  }

  /** Noise detail of the particles: 1 full, 0 cheap (low quality). */
  setDetail(detail: number): void {
    this.fire.setDetail(detail);
    this.smoke.setDetail(detail);
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
    // Debris: dark chunks thrown out of ground blasts, tumbling and landing.
    if (spec.altitude <= 0.5 && this.hf.sample(x, z) >= 0) {
      const chunks = Math.round((spec.kind === "nuke" ? 30 : 10) * k) + 2;
      for (let i = 0; i < chunks; i++) {
        const [dx, dy, dz] = randDir(0.35);
        const speed = r * (1.5 + Math.random() * 2.5);
        this.smoke.spawn(
          x,
          ground + 0.2,
          z,
          dx * speed,
          (dy + 0.6) * speed * 1.2,
          dz * speed,
          now + Math.random() * 0.05,
          1.2 + Math.random() * 1.2,
          0.05 + Math.random() * 0.05 * Math.min(3, r),
          P_DEBRIS,
        );
      }
      // Scorched ground left behind for a while.
      this.smoke.spawn(
        x,
        ground,
        z,
        0,
        0,
        0,
        now + 0.05,
        spec.kind === "nuke" ? 40 : 18,
        r * (spec.kind === "nuke" ? 2.2 : 1.6),
        P_SCORCH,
      );
    }
    // Sparks
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
