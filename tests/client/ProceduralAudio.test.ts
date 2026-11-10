import {
  AudioEventTracker,
  warIntensity,
  type AudioUnit,
} from "../../src/client/sound/procedural/AudioEvents";
import {
  chordFor,
  midiToHz,
  notesAt,
  STEPS_PER_BAR,
  tempoFor,
} from "../../src/client/sound/procedural/MusicDirector";

function voices(intensity: number): Set<string> {
  const v = new Set<string>();
  for (let bar = 0; bar < 8; bar++)
    for (let s = 0; s < STEPS_PER_BAR; s++)
      for (const n of notesAt(bar, s, intensity, 1)) v.add(n.voice);
  return v;
}

describe("MusicDirector", () => {
  test("peace is calm: pad, bass, arp, horn and no drums", () => {
    const v = voices(0.1);
    expect([...v].sort()).toEqual(["arp", "bass", "horn", "pad"]);
  });

  test("war adds drums and timpani and is faster", () => {
    const v = voices(0.9);
    for (const d of ["kick", "snare", "timpani"]) expect(v.has(d)).toBe(true);
    expect(tempoFor(0.9)).toBeGreaterThan(tempoFor(0.1));
  });

  test("war switches to the tense progression", () => {
    expect(chordFor(2, 0.1)).not.toEqual(chordFor(2, 0.9));
    expect(chordFor(0, 0.1)).toEqual(chordFor(4, 0.1)); // 4-bar loop
  });

  test("tuning", () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
});

describe("AudioEventTracker", () => {
  const unit = (
    id: number,
    unitType: string,
    ownerID: number,
    extra: Partial<AudioUnit> = {},
  ): AudioUnit => ({
    id,
    unitType,
    ownerID,
    pos: 0,
    isActive: true,
    underConstruction: false,
    ...extra,
  });

  test("first tick is silent, then new units cue once", () => {
    const t = new AudioEventTracker();
    const all = () => true;
    expect(t.update([unit(1, "Bomber", 2)], 1, all, 100)).toEqual([]);
    expect(t.update([unit(1, "Bomber", 2)], 1, all, 100)).toEqual([]);
    expect(
      t.update([unit(1, "Bomber", 2), unit(2, "Fighter", 1)], 1, all, 100),
    ).toEqual(["fighter"]);
  });

  test("other players' units out of view stay quiet", () => {
    const t = new AudioEventTracker();
    t.update([], 1, () => false, 0);
    expect(t.update([unit(5, "Bomber", 2)], 1, () => false, 0)).toEqual([]);
    expect(t.update([unit(6, "Bomber", 1)], 1, () => false, 0)).toEqual([
      "bomber",
    ]);
  });

  test("finished buildings, radar, bombs and captures", () => {
    const t = new AudioEventTracker();
    const all = () => true;
    t.update([unit(1, "City", 1, { underConstruction: true })], 1, all, 100);
    expect(t.update([unit(1, "City", 1)], 1, all, 100)).toEqual(["build"]);
    expect(
      t.update([unit(1, "City", 1), unit(2, "Radar Station", 1)], 1, all, 100),
    ).toEqual(["radar"]);
    t.update(
      [unit(1, "City", 1), unit(3, "Bomber", 2), unit(4, "Artillery Shell", 2)],
      1,
      all,
      100,
    );
    expect(
      t.update([unit(1, "City", 1), unit(3, "Bomber", 2)], 1, all, 100),
    ).toEqual(["bomb"]);
    expect(t.update([unit(1, "City", 1)], 1, all, 160)).toEqual(["capture"]);
  });

  test("battle sounds: gunfire, hits, flak and front crackle", () => {
    const t = new AudioEventTracker();
    const all = () => true;
    t.update([], 1, all, 100);
    expect(t.update([unit(7, "Shell", 2)], 1, all, 100)).toEqual(["gunfire"]);
    expect(t.update([], 1, all, 100)).toEqual(["explosion"]);
    // Off screen: silent.
    t.update([unit(8, "Shell", 2, { pos: 5 })], 1, (p) => p !== 5, 100);
    expect(t.update([], 1, (p) => p !== 5, 100)).toEqual([]);
    // Enemy plane over a flak gun.
    t.update([unit(9, "Flak Gun", 1)], 1, all, 100);
    expect(
      t.update([unit(9, "Flak Gun", 1), unit(10, "Fighter", 2)], 1, all, 100),
    ).toEqual(["fighter", "flak"]);
    // Own planes over own flak: no flak.
    const own = new AudioEventTracker();
    own.update([unit(1, "Flak Gun", 1), unit(2, "Fighter", 1)], 1, all, 0);
    expect(
      own.update([unit(1, "Flak Gun", 1), unit(2, "Fighter", 1)], 1, all, 0),
    ).toEqual([]);
    // Fighting at a front: periodic crackle, none in peace.
    const front = new AudioEventTracker();
    let crackles = 0;
    let quiet = 0;
    for (let i = 0; i < 40; i++) {
      if (front.update([], 1, all, 0, 1).includes("skirmish")) crackles++;
    }
    for (let i = 0; i < 40; i++) {
      if (front.update([], 1, all, 0, 0.15).includes("skirmish")) quiet++;
    }
    expect(crackles).toBeGreaterThanOrEqual(7);
    expect(quiet).toBe(0);
  });

  test("war intensity", () => {
    expect(warIntensity(0, 0, 1000)).toBeLessThan(0.3);
    expect(warIntensity(0, 2, 1000)).toBe(0.6);
    expect(warIntensity(100, 0, 1000)).toBe(0.85);
    expect(warIntensity(900, 0, 1000)).toBe(1);
  });
});
