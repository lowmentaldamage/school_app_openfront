export enum ReplaySpeedMultiplier {
  slow = 2,
  normal = 1,
  fast = 0.5,
  /** ×5 and ×10: turn interval multipliers (solo games and replays). */
  faster = 0.2,
  turbo = 0.1,
  fastest = 0,
}

export const defaultReplaySpeedMultiplier = ReplaySpeedMultiplier.normal;
