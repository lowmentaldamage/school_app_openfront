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
  /**
   * Aim for the display's own refresh rate (60, 90, 120, 144 Hz…) instead
   * of the fixed slowMs/fastMs: the shortest recent frame interval is the
   * vsync period, and quality steps down when frames run 30% over it.
   */
  matchRefresh?: boolean;
}

export const DEFAULT_ADAPTIVE_OPTIONS: AdaptiveQualityOptions = {
  slowMs: 24,
  fastMs: 18,
  cooldownMs: 2000,
  alpha: 0.1,
  matchRefresh: true,
};

/** Frames between refresh-period estimates. */
const REFRESH_WINDOW = 120;

export class AdaptiveQuality {
  private avgMs = 16.7;
  /** Estimated vsync period (ms); null until measured. */
  private refreshMs: number | null = null;
  private windowMin = Infinity;
  private windowCount = 0;
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

  /** The measured display refresh period, or null before the first window. */
  get refreshPeriodMs(): number | null {
    return this.refreshMs;
  }

  private thresholds(): { slow: number; fast: number } {
    if (this.options.matchRefresh && this.refreshMs !== null) {
      return { slow: this.refreshMs * 1.3, fast: this.refreshMs * 1.08 };
    }
    return { slow: this.options.slowMs, fast: this.options.fastMs };
  }

  /** Feed one frame's duration; returns true when the level changed. */
  sample(frameMs: number): boolean {
    // Ignore stalls (tab switches, GC pauses, shader compiles).
    if (!(frameMs > 0) || frameMs > 1000) return false;
    if (this.options.matchRefresh) {
      // Shortest interval in each window ≈ the vsync period. Snap to common
      // rates so jitter does not move the target around.
      if (frameMs >= 4) this.windowMin = Math.min(this.windowMin, frameMs);
      if (++this.windowCount >= REFRESH_WINDOW) {
        if (Number.isFinite(this.windowMin)) {
          this.refreshMs = snapRefresh(this.windowMin);
        }
        this.windowMin = Infinity;
        this.windowCount = 0;
      }
    }
    this.avgMs += (frameMs - this.avgMs) * this.options.alpha;
    if (this.cooldownLeft > 0) {
      this.cooldownLeft -= frameMs;
      return false;
    }
    const { slow, fast } = this.thresholds();
    if (this.avgMs > slow && this.levelIndex > 0) {
      this.ceiling = Math.min(this.ceiling, this.levelIndex);
      this.levelIndex--;
    } else if (this.avgMs < fast && this.levelIndex + 1 < this.ceiling) {
      this.levelIndex++;
    } else {
      return false;
    }
    this.cooldownLeft = this.options.cooldownMs;
    return true;
  }
}

const COMMON_RATES_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

/** Nearest common refresh period to a measured frame interval (ms). */
export function snapRefresh(intervalMs: number): number {
  const hz = 1000 / intervalMs;
  let best = COMMON_RATES_HZ[0];
  for (const r of COMMON_RATES_HZ) {
    if (Math.abs(r - hz) < Math.abs(best - hz)) best = r;
  }
  return 1000 / best;
}
