import { describe, expect, it } from "vitest";
import { AdaptiveQuality } from "../../src/client/render3d/AdaptiveQuality";

const opts = { slowMs: 24, fastMs: 18, cooldownFrames: 10, alpha: 0.5 };

function feed(q: AdaptiveQuality, ms: number, frames: number): void {
  for (let i = 0; i < frames; i++) q.sample(ms);
}

describe("AdaptiveQuality", () => {
  it("steps down when frames are slow", () => {
    const q = new AdaptiveQuality(2, opts);
    feed(q, 40, 50);
    expect(q.index).toBe(0);
  });

  it("does not climb back into a level that proved too slow", () => {
    const q = new AdaptiveQuality(1, opts, 3);
    feed(q, 40, 12); // 1 → 0, ceiling = 1
    expect(q.index).toBe(0);
    feed(q, 16, 200);
    expect(q.index).toBe(0);
  });

  it("steps up to the max level when steadily at vsync", () => {
    const q = new AdaptiveQuality(0, opts, 2);
    feed(q, 16.6, 200);
    expect(q.index).toBe(2);
  });

  it("ignores stalls", () => {
    const q = new AdaptiveQuality(2, opts);
    feed(q, 1000, 100);
    expect(q.index).toBe(2);
  });
});
