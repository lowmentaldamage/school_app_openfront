/**
 * WorldAudio — generated in-game music, world ambience and unit cues.
 *
 * Everything is synthesised with Web Audio at runtime (original material,
 * no downloads). Three buses follow the player's sliders through the
 * AudioMixer: music, ambience and effects; all go through Howler's master
 * gain, so the master slider and mute apply too.
 *
 *  - Music: MusicDirector's score, intensity from the player's wars.
 *  - Ambience: rain, wind, thunder after lightning, sea, birds by day and
 *    crickets at night, following the sky (Atmosphere) and the zoom.
 *  - Cues: bombers, fighters, bombs, torpedoes, radar pings, buildings
 *    rising and land captured.
 */

import { Howler } from "howler";
import type { AudioMixer } from "../AudioMixer";
import { midiToHz, notesAt, STEPS_PER_BAR, tempoFor } from "./MusicDirector";

export type WorldCue =
  | "bomber"
  | "fighter"
  | "bomb"
  | "torpedo"
  | "radar"
  | "build"
  | "capture";

export interface WorldState {
  daylight: number;
  rain: number;
  cloud: number;
  flash: number;
  /** Camera distance (3D) — ambience is louder close up. */
  cameraDistance: number;
}

const LOOKAHEAD_S = 0.25;
const TIMER_MS = 50;
/** Minimum gap between two cues of the same kind. */
const CUE_GAP_S: Record<WorldCue, number> = {
  bomber: 2.5,
  fighter: 0.8,
  bomb: 0.12,
  torpedo: 0.6,
  radar: 1.5,
  build: 0.3,
  capture: 2,
};

export class WorldAudio {
  private readonly ctx: AudioContext | null;
  private readonly music: GainNode | null = null;
  private readonly ambience: GainNode | null = null;
  private readonly effects: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopFollowing: () => void = () => {};

  private intensity = 0.15;
  private targetIntensity = 0.15;
  private bar = 0;
  private step = 0;
  private nextStepAt = 0;
  private seed = (Math.random() * 1e9) | 0;

  private world: WorldState = {
    daylight: 1,
    rain: 0,
    cloud: 0,
    flash: 0,
    cameraDistance: 300,
  };
  private lastFlash = 0;
  private nextBirdAt = 0;
  private nextCricketAt = 0;
  private loops: {
    rain: GainNode;
    wind: GainNode;
    sea: GainNode;
    sources: AudioScheduledSourceNode[];
  } | null = null;
  private readonly lastCue = new Map<WorldCue, number>();

  constructor(private readonly mixer: AudioMixer) {
    const ctx = (Howler as unknown as { ctx?: AudioContext }).ctx ?? null;
    const master = (Howler as unknown as { masterGain?: GainNode }).masterGain;
    this.ctx = ctx && master ? ctx : null;
    if (this.ctx === null || !master) return;
    this.music = this.ctx.createGain();
    this.ambience = this.ctx.createGain();
    this.effects = this.ctx.createGain();
    for (const g of [this.music, this.ambience, this.effects]) {
      g.gain.value = 0;
      g.connect(master);
    }
    this.applyVolumes();
    this.stopFollowing = mixer.onChange(() => this.applyVolumes());
    this.timer = setInterval(() => this.pump(), TIMER_MS);
  }

  /** 0 = peace … 1 = under heavy attack. Eased over a few seconds. */
  setIntensity(x: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, x));
  }

  setWorld(state: WorldState): void {
    this.world = state;
  }

  /** Play a unit cue (rate limited per kind). */
  cue(name: WorldCue): void {
    const ctx = this.ctx;
    if (ctx === null || this.effects === null) return;
    if (!this.mixer.isAudible("effects")) return;
    const now = ctx.currentTime;
    if (now - (this.lastCue.get(name) ?? -99) < CUE_GAP_S[name]) return;
    this.lastCue.set(name, now);
    switch (name) {
      case "bomber":
        return this.drone(now, 82, 3.2, 0.12);
      case "fighter":
        return this.whoosh(now, 0.9, 0.16);
      case "bomb":
        return this.thud(now, 0.5);
      case "torpedo":
        return this.torpedo(now);
      case "radar":
        return this.ping(now);
      case "build":
        return this.clank(now);
      case "capture":
        return this.swell(now);
    }
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopFollowing();
    for (const s of this.loops?.sources ?? []) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    for (const g of [this.music, this.ambience, this.effects]) {
      g?.disconnect();
    }
  }

  // ------------------------------------------------------------- plumbing

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const t = ctx.currentTime;
    const m = this.mixer;
    this.music?.gain.setTargetAtTime(m.channelVolume("music"), t, 0.2);
    this.effects?.gain.setTargetAtTime(m.channelVolume("effects"), t, 0.05);
    this.ambience?.gain.setTargetAtTime(m.channelVolume("ambience"), t, 0.3);
  }

  private noiseBuffer(): AudioBuffer {
    if (this.noise === null) {
      const ctx = this.ctx!;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let s = 22222;
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        d[i] = (s / 4294967296) * 2 - 1;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  private pump(): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== "running") return;
    const now = ctx.currentTime;
    // Ease intensity (τ ≈ 4 s).
    this.intensity +=
      (this.targetIntensity - this.intensity) * (1 - Math.exp(-0.05 / 4));
    if (this.mixer.isAudible("music")) this.scheduleMusic(now);
    else this.nextStepAt = 0;
    if (this.mixer.isAudible("ambience")) this.updateAmbience(now);
    else this.stopLoops();
  }

  // ---------------------------------------------------------------- music

  private scheduleMusic(now: number): void {
    if (this.nextStepAt < now) this.nextStepAt = now + 0.05;
    while (this.nextStepAt < now + LOOKAHEAD_S) {
      const t = this.nextStepAt;
      const stepDur = 60 / tempoFor(this.intensity) / 4;
      for (const n of notesAt(this.bar, this.step, this.intensity, this.seed)) {
        this.playNote(
          n.voice,
          midiToHz(n.midi),
          t,
          n.steps * stepDur,
          n.velocity,
        );
      }
      this.nextStepAt += stepDur;
      this.step++;
      if (this.step >= STEPS_PER_BAR) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private playNote(
    voice: string,
    hz: number,
    t: number,
    dur: number,
    vel: number,
  ): void {
    const ctx = this.ctx!;
    const out = this.music!;
    switch (voice) {
      case "pad": {
        const g = env(ctx, t, 0.8, dur, 1.4, vel * 0.05);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 500 + 1400 * this.intensity;
        f.connect(g).connect(out);
        for (const cents of [-7, 7]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = hz;
          o.detune.value = cents;
          o.connect(f);
          o.start(t);
          o.stop(t + dur + 1.6);
        }
        return;
      }
      case "bass": {
        const g = env(ctx, t, 0.02, dur * 0.8, 0.15, vel * 0.16);
        g.connect(out);
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = hz;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.3);
        return;
      }
      case "arp": {
        const g = pluck(ctx, t, 0.35, vel * 0.07);
        g.connect(out);
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = hz;
        o.connect(g);
        o.start(t);
        o.stop(t + 0.5);
        return;
      }
      case "horn": {
        const g = env(ctx, t, 0.18, dur, 0.6, vel * 0.045);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 1100;
        f.connect(g).connect(out);
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = hz;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5;
        const depth = ctx.createGain();
        depth.gain.value = 5;
        lfo.connect(depth).connect(o.detune);
        o.connect(f);
        o.start(t);
        lfo.start(t);
        o.stop(t + dur + 0.8);
        lfo.stop(t + dur + 0.8);
        return;
      }
      case "kick": {
        const g = pluck(ctx, t, 0.3, vel * 0.45);
        g.connect(out);
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.4);
        return;
      }
      case "snare": {
        const g = pluck(ctx, t, 0.16, vel * 0.22);
        g.connect(out);
        const n = ctx.createBufferSource();
        n.buffer = this.noiseBuffer();
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1300;
        n.connect(hp).connect(g);
        n.start(t, Math.random());
        n.stop(t + 0.2);
        return;
      }
      case "timpani": {
        const g = pluck(ctx, t, 1.4, vel * 0.32);
        g.connect(out);
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(hz * 1.04, t);
        o.frequency.exponentialRampToValueAtTime(hz, t + 0.2);
        o.connect(g);
        o.start(t);
        o.stop(t + 1.6);
        return;
      }
    }
  }

  // ------------------------------------------------------------- ambience

  private ensureLoops(): NonNullable<WorldAudio["loops"]> {
    if (this.loops !== null) return this.loops;
    const ctx = this.ctx!;
    const out = this.ambience!;
    const sources: AudioScheduledSourceNode[] = [];
    const noiseLoop = (offset: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer();
      s.loop = true;
      s.start(ctx.currentTime, offset);
      sources.push(s);
      return s;
    };
    // Rain: bright hiss.
    const rain = ctx.createGain();
    rain.gain.value = 0;
    const rhp = ctx.createBiquadFilter();
    rhp.type = "highpass";
    rhp.frequency.value = 500;
    const rlp = ctx.createBiquadFilter();
    rlp.type = "lowpass";
    rlp.frequency.value = 7000;
    noiseLoop(0).connect(rhp).connect(rlp).connect(rain).connect(out);
    // Wind: low rumble that gusts.
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const wlp = ctx.createBiquadFilter();
    wlp.type = "lowpass";
    wlp.frequency.value = 320;
    const gust = ctx.createGain();
    gust.gain.value = 0.6;
    const gustLfo = ctx.createOscillator();
    gustLfo.frequency.value = 0.13;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.4;
    gustLfo.connect(gustDepth).connect(gust.gain);
    gustLfo.start();
    sources.push(gustLfo);
    noiseLoop(0.7).connect(wlp).connect(gust).connect(wind).connect(out);
    // Sea: slow swells.
    const sea = ctx.createGain();
    sea.gain.value = 0;
    const sbp = ctx.createBiquadFilter();
    sbp.type = "bandpass";
    sbp.frequency.value = 420;
    sbp.Q.value = 0.7;
    const swell = ctx.createGain();
    swell.gain.value = 0.55;
    const swellLfo = ctx.createOscillator();
    swellLfo.frequency.value = 0.09;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.45;
    swellLfo.connect(swellDepth).connect(swell.gain);
    swellLfo.start();
    sources.push(swellLfo);
    noiseLoop(1.3).connect(sbp).connect(swell).connect(sea).connect(out);
    this.loops = { rain, wind, sea, sources };
    return this.loops;
  }

  private stopLoops(): void {
    if (this.loops === null) return;
    for (const s of this.loops.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.loops = null;
  }

  private updateAmbience(now: number): void {
    const w = this.world;
    const loops = this.ensureLoops();
    // Closer to the ground → louder world.
    const near = clamp(1 - (w.cameraDistance - 60) / 700, 0.2, 1);
    loops.rain.gain.setTargetAtTime(w.rain * 0.22 * near, now, 0.8);
    loops.wind.gain.setTargetAtTime((0.03 + w.cloud * 0.12) * near, now, 1.2);
    loops.sea.gain.setTargetAtTime(0.05 * near, now, 1.5);
    // Thunder a moment after each lightning flash.
    if (w.flash > 0.5 && this.lastFlash <= 0.5) {
      this.thunder(now + 0.4 + Math.random() * 1.2, near);
    }
    this.lastFlash = w.flash;
    // Birds by day (not in rain), crickets at night.
    const birds = w.daylight * (1 - w.rain) * near;
    if (birds > 0.2 && now >= this.nextBirdAt) {
      this.chirp(now, birds);
      this.nextBirdAt = now + 1 + Math.random() * 3.5;
    }
    const crickets = (1 - w.daylight) * (1 - w.rain) * near;
    if (crickets > 0.2 && now >= this.nextCricketAt) {
      this.cricket(now, crickets);
      this.nextCricketAt = now + 0.6 + Math.random() * 0.8;
    }
  }

  private thunder(t: number, near: number): void {
    const ctx = this.ctx!;
    const g = env(ctx, t, 0.05, 0.6, 2.4, 0.5 * (0.5 + near * 0.5));
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    lp.connect(g).connect(this.ambience!);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.connect(lp);
    n.start(t, Math.random());
    n.stop(t + 3.2);
  }

  private chirp(t: number, amount: number): void {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const s = t + i * (0.09 + Math.random() * 0.05);
      const g = pluck(ctx, s, 0.08, 0.02 * amount);
      g.connect(this.ambience!);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, s + 0.06);
      o.connect(g);
      o.start(s);
      o.stop(s + 0.12);
    }
  }

  private cricket(t: number, amount: number): void {
    const ctx = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.045;
      const g = pluck(ctx, s, 0.03, 0.012 * amount);
      g.connect(this.ambience!);
      const o = ctx.createOscillator();
      o.frequency.value = 4400;
      o.connect(g);
      o.start(s);
      o.stop(s + 0.05);
    }
  }

  // ----------------------------------------------------------------- cues

  private drone(t: number, hz: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const g = env(ctx, t, 0.9, dur - 1.8, 0.9, vol);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    lp.connect(g).connect(this.effects!);
    for (const d of [0, 3.5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(hz + d, t);
      // Doppler: a little higher coming in, lower going away.
      o.frequency.linearRampToValueAtTime((hz + d) * 0.92, t + dur);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private whoosh(t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const g = env(ctx, t, dur * 0.4, 0, dur * 0.6, vol);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    bp.connect(g).connect(this.effects!);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.connect(bp);
    n.start(t, Math.random());
    n.stop(t + dur + 0.05);
  }

  private thud(t: number, vol: number): void {
    const ctx = this.ctx!;
    const g = pluck(ctx, t, 0.6, vol);
    g.connect(this.effects!);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.7);
    const ng = pluck(ctx, t, 0.35, vol * 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(ng).connect(this.effects!);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.connect(lp);
    n.start(t, Math.random());
    n.stop(t + 0.4);
  }

  private torpedo(t: number): void {
    const ctx = this.ctx!;
    const g = env(ctx, t, 0.05, 0.5, 0.3, 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 14;
    const depth = ctx.createGain();
    depth.gain.value = 300;
    lfo.connect(depth).connect(bp.frequency);
    bp.connect(g).connect(this.effects!);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.connect(bp);
    n.start(t, Math.random());
    lfo.start(t);
    n.stop(t + 0.9);
    lfo.stop(t + 0.9);
    this.thud(t + 0.85, 0.3);
  }

  private ping(t: number): void {
    const ctx = this.ctx!;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.26;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    const g = pluck(ctx, t, 0.5, 0.08);
    g.connect(this.effects!);
    g.connect(delay);
    delay.connect(this.effects!);
    const o = ctx.createOscillator();
    o.frequency.value = 1250;
    o.connect(g);
    o.start(t);
    o.stop(t + 0.6);
    // Let the echo ring out, then free the loop.
    setTimeout(() => {
      delay.disconnect();
      fb.disconnect();
    }, 2500);
  }

  private clank(t: number): void {
    const ctx = this.ctx!;
    for (const [hz, dt] of [
      [220, 0],
      [330, 0.09],
    ] as const) {
      const g = pluck(ctx, t + dt, 0.18, 0.05);
      g.connect(this.effects!);
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = hz;
      o.connect(g);
      o.start(t + dt);
      o.stop(t + dt + 0.25);
    }
    this.thud(t, 0.18);
  }

  private swell(t: number): void {
    const ctx = this.ctx!;
    const g = env(ctx, t, 0.25, 0.1, 0.5, 0.06);
    g.connect(this.effects!);
    for (const ratio of [1, 1.5]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(220 * ratio, t);
      o.frequency.exponentialRampToValueAtTime(330 * ratio, t + 0.4);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.9);
    }
  }
}

/** Gain envelope: attack, hold, release (seconds) to `peak`. */
function env(
  ctx: AudioContext,
  t: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + Math.max(0, hold));
  g.gain.linearRampToValueAtTime(0, t + attack + Math.max(0, hold) + release);
  return g;
}

/** Percussive envelope: instant attack, exponential decay. */
function pluck(
  ctx: AudioContext,
  t: number,
  decay: number,
  peak: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(peak, 1e-4), t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + decay);
  return g;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
