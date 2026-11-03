/**
 * Atmosphere — day/night cycle and weather, as pure maths (no WebGL), so
 * it can be unit tested and every player sees the same sky: both are a
 * function of the game tick only (plus a per-game seed).
 *
 * Visual only. Nothing here touches the simulation. Night and storms keep
 * a floor of ambient light so territory colours stay readable.
 */

/** One full day, in game ticks (10 ticks/s → 12 minutes). */
export const DAY_TICKS = 7200;
/** Share of the cycle the sun is up. */
const DAY_FRACTION = 0.68;
/** Each weather spell lasts this long (3 minutes). */
export const WEATHER_TICKS = 1800;
/** Cross-fade between spells over the last part of each one. */
const WEATHER_FADE_TICKS = 300;

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm" | "fog";

export interface AtmosphereOptions {
  dayNight: boolean;
  weather: boolean;
}

export interface AtmosphereState {
  /** Unit vector towards the sun (y up). */
  sunDir: [number, number, number];
  /** Linear RGB, 0..1. */
  sunColor: [number, number, number];
  sunIntensity: number;
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  hemiIntensity: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** Multiplies the distance-based fog density. */
  fogMul: number;
  /** 0..1 rain amount (streak opacity and count). */
  rain: number;
  /** 0..1 cloud cover (dims sun, greys sky). */
  cloud: number;
  /** 0..1 lightning flash this frame. */
  flash: number;
  /** 0..1, 1 = full day. */
  daylight: number;
  weather: WeatherKind;
}

type RGB = [number, number, number];

const DAY_ZENITH: RGB = [0.247, 0.498, 0.769];
const DAY_HORIZON: RGB = [0.788, 0.863, 0.902];
const DUSK_ZENITH: RGB = [0.22, 0.27, 0.48];
const DUSK_HORIZON: RGB = [0.95, 0.62, 0.42];
const NIGHT_ZENITH: RGB = [0.03, 0.05, 0.12];
const NIGHT_HORIZON: RGB = [0.12, 0.16, 0.26];
const STORM_SKY: RGB = [0.36, 0.39, 0.43];

const DAY_SUN: RGB = [1.0, 0.945, 0.863];
const DUSK_SUN: RGB = [1.0, 0.62, 0.38];
const MOON: RGB = [0.62, 0.72, 1.0];

const DAY_SKY_LIGHT: RGB = [0.875, 0.933, 1.0];
const NIGHT_SKY_LIGHT: RGB = [0.58, 0.68, 0.95];
const GROUND_LIGHT: RGB = [0.29, 0.247, 0.173];

/** The fixed sun of the classic (no cycle) view. */
const FIXED_SUN = norm([-0.55, 0.75, -0.35]);

function norm(v: RGB): RGB {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** Integer hash → [0, 1). */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** The weather of spell `index` (spell 0 is always clear). */
export function weatherForSpell(index: number, seed: number): WeatherKind {
  if (index <= 0) return "clear";
  const r = hash01(index, seed);
  if (r < 0.5) return "clear";
  if (r < 0.7) return "cloudy";
  if (r < 0.87) return "rain";
  if (r < 0.95) return "fog";
  return "storm";
}

interface WeatherLook {
  cloud: number;
  rain: number;
  fog: number;
  storm: number;
}

const LOOKS: Record<WeatherKind, WeatherLook> = {
  clear: { cloud: 0, rain: 0, fog: 1, storm: 0 },
  cloudy: { cloud: 0.55, rain: 0, fog: 1.15, storm: 0 },
  rain: { cloud: 0.8, rain: 0.7, fog: 1.5, storm: 0 },
  fog: { cloud: 0.5, rain: 0, fog: 3.2, storm: 0 },
  storm: { cloud: 1, rain: 1, fog: 1.9, storm: 1 },
};

function blendLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook {
  return {
    cloud: a.cloud + (b.cloud - a.cloud) * t,
    rain: a.rain + (b.rain - a.rain) * t,
    fog: a.fog + (b.fog - a.fog) * t,
    storm: a.storm + (b.storm - a.storm) * t,
  };
}

/**
 * Sky and light for a (possibly fractional) game tick.
 * The day starts mid-morning so a new game opens in daylight.
 */
export function atmosphereAt(
  tick: number,
  options: AtmosphereOptions,
  seed = 0,
): AtmosphereState {
  // ---- time of day -------------------------------------------------------
  let sunDir: RGB = FIXED_SUN;
  let elev = 1; // sine of sun elevation (−1 midnight .. 1 noon)
  let lightScale = 1; // dims the key light near the horizon
  if (options.dayNight) {
    const phase = (((tick / DAY_TICKS + 0.12) % 1) + 1) % 1; // 0 = sunrise
    if (phase < DAY_FRACTION) {
      // Sun: rises in the east (+x), sets in the west, leaning south.
      const ang = (phase / DAY_FRACTION) * Math.PI;
      elev = Math.sin(ang);
      sunDir = norm([Math.cos(ang), Math.max(0.18, elev), -0.35]);
      lightScale = 0.4 + 0.6 * smooth(elev / 0.3);
    } else {
      // Moon: the same arc through the night.
      const ang = ((phase - DAY_FRACTION) / (1 - DAY_FRACTION)) * Math.PI;
      elev = -Math.sin(ang);
      sunDir = norm([Math.cos(ang), Math.max(0.25, -elev), -0.3]);
      lightScale = 0.4 + 0.6 * smooth(-elev / 0.3);
    }
  }
  const daylight = smooth((elev + 0.1) / 0.4); // 0 at night, 1 by mid-morning
  const dusk = options.dayNight ? clamp01(1 - Math.abs(elev) / 0.3) : 0;

  let zenith = mix(NIGHT_ZENITH, DAY_ZENITH, daylight);
  let horizon = mix(NIGHT_HORIZON, DAY_HORIZON, daylight);
  zenith = mix(zenith, DUSK_ZENITH, dusk * 0.6);
  horizon = mix(horizon, DUSK_HORIZON, dusk * 0.7);

  let sunColor = elev >= 0 ? mix(DUSK_SUN, DAY_SUN, smooth(elev / 0.4)) : MOON;
  let sunIntensity = (elev >= 0 ? 2.6 : 1.8) * lightScale;
  let hemiSky = mix(NIGHT_SKY_LIGHT, DAY_SKY_LIGHT, daylight);
  // Night floor: territory and borders must stay readable.
  let hemiIntensity = 1.25 - 0.15 * daylight;

  // ---- weather -----------------------------------------------------------
  let look = LOOKS.clear;
  let weather: WeatherKind = "clear";
  if (options.weather) {
    const spell = Math.floor(tick / WEATHER_TICKS);
    const into = tick - spell * WEATHER_TICKS;
    const cur = weatherForSpell(spell, seed);
    const next = weatherForSpell(spell + 1, seed);
    const fadeStart = WEATHER_TICKS - WEATHER_FADE_TICKS;
    const t = smooth((into - fadeStart) / WEATHER_FADE_TICKS);
    look = blendLook(LOOKS[cur], LOOKS[next], t);
    weather = t > 0.5 ? next : cur;
  }

  const overcast = look.cloud;
  const greySky = mix(STORM_SKY, NIGHT_ZENITH, 1 - daylight);
  zenith = mix(zenith, greySky, overcast * 0.75);
  horizon = mix(horizon, mix(greySky, horizon, 0.35), overcast * 0.7);
  sunIntensity *= 1 - overcast * 0.45;
  sunColor = mix(sunColor, [0.85, 0.88, 0.92], overcast * 0.5);
  hemiSky = mix(hemiSky, [0.7, 0.74, 0.8], overcast * 0.5);
  hemiIntensity *= 1 + overcast * 0.3; // diffuse light makes up for the sun

  // Lightning: a few short flashes per storm spell, same for everyone.
  let flash = 0;
  if (look.storm > 0.5) {
    const slot = Math.floor(tick / 7);
    if (hash01(slot, seed ^ 0x51ed) < 0.035) {
      const f = (tick / 7) % 1;
      flash = (1 - f) * look.storm;
    }
  }
  if (flash > 0) {
    hemiIntensity += flash * 1.4;
    zenith = mix(zenith, [0.8, 0.82, 0.95], flash * 0.6);
    horizon = mix(horizon, [0.85, 0.87, 0.95], flash * 0.6);
  }

  return {
    sunDir,
    sunColor,
    sunIntensity,
    hemiSky,
    hemiGround: mix(GROUND_LIGHT, [0.2, 0.2, 0.26], 1 - daylight),
    hemiIntensity,
    zenith,
    horizon,
    fogMul: look.fog,
    rain: look.rain,
    cloud: overcast,
    flash,
    daylight,
    weather,
  };
}
