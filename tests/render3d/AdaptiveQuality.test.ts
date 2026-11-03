import { describe, expect, it } from "vitest";
import {
  AdaptiveQuality,
  snapRefresh,
} from "../../src/client/render3d/AdaptiveQuality";

const opts = { slowMs: 24, fastMs: 18, cooldownMs: 500, alpha: 0.5 };

function feed(q: AdaptiveQuality, ms: number, frames: number): void {
  for (let i = 0; i < frames; i++) q.sample(ms);
}

describe("AdaptiveQuality", () => {
  it("steps down when frames are slow", () => {
    const q = new AdaptiveQuality(3, opts);
    feed(q, 40, 200);
    expect(q.index).toBe(0);
  });

  it("reacts within seconds of wall-clock time even at very low fps", () => {
    const q = new AdaptiveQuality(3, opts);
    // 300 ms frames (~3 fps): cooldown is time-based, so the first step
    // happens after ~2 frames, not after a fixed frame count.
    feed(q, 300, 3);
    expect(q.index).toBe(2);
  });

  it("does not climb back into a level that proved too slow", () => {
    const q = new AdaptiveQuality(1, opts, 3);
    feed(q, 40, 20); // 1 → 0, ceiling = 1
    expect(q.index).toBe(0);
    feed(q, 16, 400);
    expect(q.index).toBe(0);
  });

  it("steps up to the max level when steadily at vsync", () => {
    const q = new AdaptiveQuality(0, opts, 2);
    feed(q, 16.6, 400);
    expect(q.index).toBe(2);
  });

  it("clamps the starting level to the max", () => {
    expect(new AdaptiveQuality(4, opts, 2).index).toBe(2);
  });

  it("ignores stalls", () => {
    const q = new AdaptiveQuality(2, opts);
    feed(q, 5000, 100);
    expect(q.index).toBe(2);
  });
});

describe("AdaptiveQuality matching the display refresh", () => {
  const refreshOpts = { ...opts, matchRefresh: true };

  it("snaps measured intervals to common refresh rates", () => {
    expect(1000 / snapRefresh(8.4)).toBeCloseTo(120, 6);
    expect(1000 / snapRefresh(16.9)).toBeCloseTo(60, 6);
    expect(1000 / snapRefresh(6.8)).toBeCloseTo(144, 6);
  });

  it("on a 120 Hz screen, 60 fps counts as too slow", () => {
    const q = new AdaptiveQuality(3, refreshOpts);
    feed(q, 8.33, 130); // measure the 120 Hz period
    expect(q.refreshPeriodMs).toBeCloseTo(1000 / 120, 3);
    // Frames at 60 fps, but one quick frame per window keeps the estimate.
    for (let i = 0; i < 400; i++) q.sample(i % 100 === 0 ? 8.33 : 16.7);
    expect(q.index).toBeLessThan(3);
  });

  it("on a 60 Hz screen, steady 60 fps keeps full quality", () => {
    const q = new AdaptiveQuality(3, refreshOpts, 3);
    feed(q, 16.7, 600);
    expect(q.index).toBe(3);
  });
});
