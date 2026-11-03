/**
 * MusicDirector — the score of the generated in-game music, as pure data.
 *
 * Original, generated on the fly (no recordings, no licences): a slow
 * D-minor march that turns tense when the player is at war. Intensity
 * (0 = peace, 1 = under attack) chooses the chord progression, tempo and
 * which layers play: pad and bass always, a soft arpeggio and horn line in
 * peace, then kick, snare, timpani and snare rolls as the war heats up.
 *
 * WorldAudio turns the notes into sound; this file has no Web Audio, so the
 * arrangement is unit tested.
 */

export type Voice =
  | "pad"
  | "bass"
  | "arp"
  | "horn"
  | "kick"
  | "snare"
  | "timpani";

export interface MusicNote {
  voice: Voice;
  /** MIDI note number (drums: ignored except timpani). */
  midi: number;
  /** 0..1 */
  velocity: number;
  /** Length in 16th-note steps. */
  steps: number;
}

/** Root-position triads, MIDI of the chord root (octave 3). */
const PEACE: readonly (readonly number[])[] = [
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [53, 57, 60], // F
  [48, 52, 55], // C
];
const WAR: readonly (readonly number[])[] = [
  [50, 53, 57], // Dm
  [55, 58, 62], // Gm
  [57, 61, 64], // A (harmonic minor: the tense dominant)
  [50, 53, 57], // Dm
];
/** D natural minor, for the horn line. */
const SCALE = [62, 64, 65, 67, 69, 70, 72, 74];

export const STEPS_PER_BAR = 16;

/** Beats per minute at this intensity. */
export function tempoFor(intensity: number): number {
  return 76 + 34 * clamp01(intensity);
}

/** The chord (MIDI notes) of `bar`. War music from intensity 0.5. */
export function chordFor(bar: number, intensity: number): readonly number[] {
  const prog = intensity >= 0.5 ? WAR : PEACE;
  return prog[((bar % prog.length) + prog.length) % prog.length];
}

/** Every note that starts on `step` (0..15) of `bar`. */
export function notesAt(
  bar: number,
  step: number,
  intensity: number,
  seed = 0,
): MusicNote[] {
  const i = clamp01(intensity);
  const chord = chordFor(bar, i);
  const out: MusicNote[] = [];
  const beat = step % 4 === 0;

  // Pad: the whole chord, held for the bar.
  if (step === 0) {
    for (const n of chord) {
      out.push({ voice: "pad", midi: n, velocity: 0.5, steps: 16 });
    }
  }
  // Bass: roots on 1 and 3 in peace, marching eighths at war.
  const bassEvery = i >= 0.6 ? 2 : 8;
  if (step % bassEvery === 0) {
    out.push({
      voice: "bass",
      midi: chord[0] - 12,
      velocity: step === 0 ? 0.8 : 0.55,
      steps: bassEvery,
    });
  }
  // Arpeggio: chord tones in eighths, softer as the drums come in.
  if (step % 2 === 0) {
    const idx = (step / 2) % 4;
    const n = idx === 3 ? chord[1] + 12 : chord[idx] + 12;
    out.push({
      voice: "arp",
      midi: n,
      velocity: 0.35 * (1 - 0.5 * i),
      steps: 2,
    });
  }
  // Horn: a slow, seeded melody in peace (two notes per bar).
  if (i < 0.7 && (step === 0 || step === 8)) {
    const r = hash(bar * 2 + (step === 8 ? 1 : 0), seed);
    if (r < 0.75) {
      out.push({
        voice: "horn",
        midi: SCALE[Math.floor(hash(bar, seed + 7) * SCALE.length)],
        velocity: 0.4,
        steps: 7,
      });
    }
  }
  // Drums.
  if (i >= 0.35 && beat && (step === 0 || step === 8 || i >= 0.75)) {
    out.push({ voice: "kick", midi: 36, velocity: 0.8, steps: 1 });
  }
  if (i >= 0.5 && (step === 4 || step === 12)) {
    out.push({ voice: "snare", midi: 38, velocity: 0.6, steps: 1 });
  }
  // Snare roll into every fourth bar when it is fierce.
  if (i >= 0.75 && bar % 4 === 3 && step >= 12) {
    out.push({
      voice: "snare",
      midi: 38,
      velocity: 0.3 + 0.1 * (step - 12),
      steps: 1,
    });
  }
  if (i >= 0.6 && step === 0) {
    out.push({
      voice: "timpani",
      midi: chord[0] - 24,
      velocity: 0.7,
      steps: 8,
    });
  }
  return out;
}

/** Frequency of a MIDI note. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}
