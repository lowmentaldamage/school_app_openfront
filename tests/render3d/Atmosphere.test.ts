import {
  atmosphereAt,
  DAY_TICKS,
  WEATHER_TICKS,
  weatherForSpell,
} from "../../src/client/render3d/environment/Atmosphere";

const OFF = { dayNight: false, weather: false };
const ON = { dayNight: true, weather: true };

describe("Atmosphere", () => {
  test("both off keeps the classic fixed sky at any tick", () => {
    const a = atmosphereAt(0, OFF);
    const b = atmosphereAt(123_456, OFF);
    expect(b).toEqual(a);
    expect(a.sunIntensity).toBeCloseTo(2.6);
    expect(a.hemiIntensity).toBeCloseTo(1.1);
    expect(a.rain).toBe(0);
    expect(a.fogMul).toBe(1);
  });

  test("a game starts in daylight and has a night", () => {
    const opts = { dayNight: true, weather: false };
    expect(atmosphereAt(0, opts).daylight).toBeGreaterThan(0.9);
    let minDay = 1;
    let minHemi = Infinity;
    for (let t = 0; t < DAY_TICKS; t += 50) {
      const s = atmosphereAt(t, opts);
      minDay = Math.min(minDay, s.daylight);
      minHemi = Math.min(minHemi, s.hemiIntensity);
      expect(s.sunDir[1]).toBeGreaterThan(0); // light always from above
    }
    expect(minDay).toBe(0);
    // Readable at night.
    expect(minHemi).toBeGreaterThanOrEqual(0.7);
  });

  test("the cycle repeats every day", () => {
    const opts = { dayNight: true, weather: false };
    const a = atmosphereAt(1000, opts);
    const b = atmosphereAt(1000 + DAY_TICKS, opts);
    for (let i = 0; i < 3; i++) expect(b.sunDir[i]).toBeCloseTo(a.sunDir[i]);
  });

  test("weather depends only on tick and seed", () => {
    expect(weatherForSpell(0, 7)).toBe("clear");
    const kinds = new Set<string>();
    for (let i = 1; i < 400; i++) kinds.add(weatherForSpell(i, 7));
    expect([...kinds].sort()).toEqual(
      ["clear", "cloudy", "fog", "rain", "storm"].sort(),
    );
    const t = WEATHER_TICKS * 5 + 100;
    expect(atmosphereAt(t, ON, 7)).toEqual(atmosphereAt(t, ON, 7));
  });

  test("rainy spells rain and darken the sun; transitions are smooth", () => {
    let spell = 1;
    while (weatherForSpell(spell, 3) !== "rain") spell++;
    const mid = atmosphereAt(spell * WEATHER_TICKS + 200, ON, 3);
    expect(mid.weather).toBe("rain");
    expect(mid.rain).toBeGreaterThan(0.5);
    const clear = atmosphereAt(
      spell * WEATHER_TICKS + 200,
      { dayNight: true, weather: false },
      3,
    );
    expect(mid.sunIntensity).toBeLessThan(clear.sunIntensity);
    let prev = atmosphereAt(0, ON, 3).fogMul;
    for (let t = 1; t < WEATHER_TICKS * 30; t += 5) {
      const f = atmosphereAt(t, ON, 3).fogMul;
      expect(Math.abs(f - prev)).toBeLessThan(0.1);
      prev = f;
    }
  });
});
