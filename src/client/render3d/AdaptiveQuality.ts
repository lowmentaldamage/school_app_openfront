/**
 * AdaptiveQuality — steps rendering quality down when frames are slow and
 * back up when there is headroom. Pure logic (no three.js) so it is unit
 * testable; WorldRenderer applies the chosen level.
 *
 * Input is the frame interval (RAF to RAF), which vsync caps at the display
 * rate, so "fast" means "steadily hitting vsync". Uses an exponential moving
 * average, a wall-clock cooldown between changes (so a slow phone reacts in
 * seconds, not after N slow frames), and remembers the lowest level that
 * proved too slow so it never climbs back into it (no oscillation).
 */

export interface QualityLevel {
  name: string;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { name: "minimal", pixelRatioCap: 0.6, shadows: false, shadowMapSize: 512 },
  { name: "low", pixelRatioCap: 1, shadows: false, shadowMapSize: 1024 },
  { name: "medium", pixelRatioCap: 1, shadows: true, shadowMapSize: 1024 },
  { name: "high", pixelRatioCap: 1.5, shadows: true, shadowMapSize: 2048 },
  { name: "ultra", pixelRatioCap: 2, shadows: true, shadowMapSize: 4096 },
];

export interface AdaptiveQualityOptions {
  /** Step down above this average frame time (ms). */
  slowMs: number;
  /** Step up below this average frame time (ms). */
  fastMs: number;
  /** Wall-clock time to wait after any change before deciding again. */
  cooldownMs: number;
  /** EMA smoothing factor per frame. */
  alpha: number;
}

export const DEFAULT_ADAPTIVE_OPTIONS: AdaptiveQualityOptions = {
  slowMs: 24,
  fastMs: 18,
  cooldownMs: 2000,
  alpha: 0.1,
};

export class AdaptiveQuality {
  private avgMs = 16.7;
  private cooldownLeft: number;
  /** Lowest level index that was too slow; never step up into it. */
  private ceiling: number;

  constructor(
    private levelIndex = 3,
    private readonly options: AdaptiveQualityOptions = DEFAULT_ADAPTIVE_OPTIONS,
    maxIndex = 3,
  ) {
    this.cooldownLeft = options.cooldownMs;
    this.ceiling = Math.min(maxIndex, QUALITY_LEVELS.length - 1) + 1;
    this.levelIndex = Math.min(levelIndex, this.ceiling - 1);
  }

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.levelIndex];
  }

  get index(): number {
    return this.levelIndex;
  }

  get averageFrameMs(): number {
    return this.avgMs;
  }

  /** Feed one frame's duration; returns true when the level changed. */
  sample(frameMs: number): boolean {
    // Ignore stalls (tab switches, GC pauses, shader compiles).
    if (!(frameMs > 0) || frameMs > 1000) return false;
    this.avgMs += (frameMs - this.avgMs) * this.options.alpha;
    if (this.cooldownLeft > 0) {
      this.cooldownLeft -= frameMs;
      return false;
    }
    if (this.avgMs > this.options.slowMs && this.levelIndex > 0) {
      this.ceiling = Math.min(this.ceiling, this.levelIndex);
      this.levelIndex--;
    } else if (
      this.avgMs < this.options.fastMs &&
      this.levelIndex + 1 < this.ceiling
    ) {
      this.levelIndex++;
    } else {
      return false;
    }
    this.cooldownLeft = this.options.cooldownMs;
    return true;
  }
}
