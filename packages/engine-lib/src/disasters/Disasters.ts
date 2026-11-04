/**
 * Natural disasters — volcanoes, earthquakes, tsunamis, storms and
 * wildfires (game option "disasters": off / rare / normal / frequent).
 *
 * Shared by the engine (rules) and the client (markers, help text), so both
 * agree. Pure data and integer maths; deterministic.
 *
 * Medium strength: a disaster hurts a region (troops, buildings, ships) but
 * never takes more than LOSS_CAP_PERCENT of any player's army and never
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
export const LOSS_CAP_PERCENT = 20;

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
  /** Buildings at level 1 may be destroyed (else they are spared). */
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

/** Tsunamis reach this far inland. */
export const COAST_TILES = 4;
/** Ticks between the pulses of a long disaster (wildfire, storm). */
export const PULSE_TICKS = 40;

export const DISASTERS: Readonly<Record<DisasterKind, DisasterSpec>> = {
  volcano: {
    kind: "volcano",
    radius: 12,
    lossPerMille: 2_500,
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
    lossPerMille: 1_200,
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
    lossPerMille: 1_500,
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
    lossPerMille: 300,
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
    lossPerMille: 1_800,
    buildingHitPerMille: 250,
    destroysBuildings: false,
    shipSinkPerMille: 0,
    warshipDamage: 0,
    coastOnly: false,
    pulses: 3,
  },
};

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
