/**
 * Natural disasters — volcanoes, earthquakes, tsunamis, storms and
 * wildfires (game option "disasters": off / rare / normal / frequent).
 *
 * Shared by the engine (rules) and the client (markers, help text), so both
 * agree. Pure data and integer maths; deterministic.
 *
 * Medium strength: a disaster hurts a region (troops, buildings, ships) but
 * never takes more than LOSS_CAP_PERCENT (12%) of any player's army and never
 * takes land. Each one is announced WARNING_TICKS before it hits.
 */

import {
  DISASTER_KINDS,
  type DisasterFrequency,
  type DisasterKind,
} from "@laukolaroser/engine-api/game/GameTypes";

export { DISASTER_KINDS, type DisasterFrequency, type DisasterKind };

/** Warning before a disaster hits (10 s). */
export const WARNING_TICKS = 100;
/** No disaster in the first minutes after the spawn phase (3 min). */
export const GRACE_TICKS = 1_800;
/** A player loses at most this share of their troops to one disaster. */
export const LOSS_CAP_PERCENT = 12;

/** Average ticks between disasters, by frequency (10 ticks = 1 s). */
export const DISASTER_INTERVAL: Readonly<
  Record<Exclude<DisasterFrequency, "off">, number>
> = {
  rare: 6_000, // 10 min
  normal: 3_000, // 5 min
  frequent: 1_200, // 2 min
};

export interface DisasterSpec {
  kind: DisasterKind;
  /** Area hit, tiles. */
  radius: number;
  /**
   * Troop losses for each player in the area: troops × tilesHit ×
   * lossPerMille ÷ (tilesOwned × 1000), capped (LOSS_CAP_PERCENT).
   */
  lossPerMille: number;
  /** Per-mille chance each building in the area loses a level. */
  buildingHitPerMille: number;
  /**
   * Level-1 buildings anywhere in the area may be destroyed (volcanoes);
   * otherwise only those near the centre (CORE_FRACTION of the radius).
   */
  destroysBuildings: boolean;
  /** Per-mille chance each transport / trade ship in the area sinks. */
  shipSinkPerMille: number;
  /** Health removed from warships in the area. */
  warshipDamage: number;
  /** Only coastal land (within COAST_TILES of the ocean) is hurt. */
  coastOnly: boolean;
  /** Hits in this many pulses, PULSE_TICKS apart (losses split). */
  pulses: number;
}

/** Share of the radius where any disaster can flatten level-1 buildings. */
export const CORE_PERCENT = 40;

/** Tsunamis reach this far inland. */
export const COAST_TILES = 4;
/** Ticks between the pulses of a long disaster (wildfire, storm). */
export const PULSE_TICKS = 40;

export const DISASTERS: Readonly<Record<DisasterKind, DisasterSpec>> = {
  volcano: {
    kind: "volcano",
    radius: 12,
    lossPerMille: 5_000,
    buildingHitPerMille: 700,
    destroysBuildings: true,
    shipSinkPerMille: 300,
    warshipDamage: 300,
    coastOnly: false,
    pulses: 1,
  },
  earthquake: {
    kind: "earthquake",
    radius: 18,
    lossPerMille: 2_500,
    buildingHitPerMille: 500,
    destroysBuildings: false,
    shipSinkPerMille: 0,
    warshipDamage: 0,
    coastOnly: false,
    pulses: 1,
  },
  tsunami: {
    kind: "tsunami",
    radius: 22,
    lossPerMille: 3_000,
    buildingHitPerMille: 450,
    destroysBuildings: false,
    shipSinkPerMille: 600,
    warshipDamage: 400,
    coastOnly: true,
    pulses: 1,
  },
  storm: {
    kind: "storm",
    radius: 26,
    lossPerMille: 600,
    buildingHitPerMille: 0,
    destroysBuildings: false,
    shipSinkPerMille: 350,
    warshipDamage: 250,
    coastOnly: true,
    pulses: 3,
  },
  wildfire: {
    kind: "wildfire",
    radius: 10,
    lossPerMille: 3_500,
    buildingHitPerMille: 250,
    destroysBuildings: false,
    shipSinkPerMille: 0,
    warshipDamage: 0,
    coastOnly: false,
    pulses: 3,
  },
};

/** How likely each kind is picked (it falls back to others if no place fits). */
export const DISASTER_WEIGHTS: Readonly<Record<DisasterKind, number>> = {
  earthquake: 30,
  volcano: 20,
  wildfire: 20,
  tsunami: 15,
  storm: 15,
};

/**
 * Kinds in the order to try: one picked by weight first, then the rest by
 * weight (rand1000 in [0, 1000)).
 */
export function disasterKindOrder(rand1000: number): DisasterKind[] {
  const total = DISASTER_KINDS.reduce((s, k) => s + DISASTER_WEIGHTS[k], 0);
  let r = Math.floor((rand1000 * total) / 1000);
  let first: DisasterKind = DISASTER_KINDS[0];
  for (const k of DISASTER_KINDS) {
    if (r < DISASTER_WEIGHTS[k]) {
      first = k;
      break;
    }
    r -= DISASTER_WEIGHTS[k];
  }
  const rest = [...DISASTER_KINDS]
    .filter((k) => k !== first)
    .sort((a, b) => DISASTER_WEIGHTS[b] - DISASTER_WEIGHTS[a]);
  return [first, ...rest];
}

/** Ticks between two disasters: the average ± 30% (rand in [0, 1000)). */
export function disasterGap(
  frequency: Exclude<DisasterFrequency, "off">,
  rand1000: number,
): number {
  const avg = DISASTER_INTERVAL[frequency];
  return Math.floor((avg * (700 + (rand1000 * 600) / 1000)) / 1000);
}

/**
 * Troops a player loses to one pulse of a disaster. Integer maths; never
 * more than LOSS_CAP_PERCENT of their army (spread over the pulses).
 */
export function disasterTroopLoss(
  spec: DisasterSpec,
  troops: number,
  tilesOwned: number,
  tilesHit: number,
): number {
  if (troops <= 0 || tilesHit <= 0) return 0;
  const raw = Math.floor(
    (troops * tilesHit * spec.lossPerMille) /
      (Math.max(1, tilesOwned) * 1000 * spec.pulses),
  );
  const cap = Math.floor((troops * LOSS_CAP_PERCENT) / (100 * spec.pulses));
  return Math.min(raw, cap);
}

/**
 * Who may set off a disaster at once (the "test disaster" button): anyone
 * in a solo game; in multiplayer only the lobby host, and only with host
 * cheats on (so it can never decide a real match).
 */
export function canTriggerDisaster(
  singleplayer: boolean,
  isLobbyCreator: boolean,
  hostCheatsOn: boolean,
): boolean {
  return singleplayer || (isLobbyCreator && hostCheatsOn);
}
