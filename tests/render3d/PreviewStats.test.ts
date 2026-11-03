import { summarisePixels } from "../../src/client/render3d/tools/PreviewStats";

function image(n: number, px: (i: number) => [number, number, number]) {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = px(i);
    a.set([r, g, b, 255], i * 4);
  }
  return a;
}

describe("summarisePixels", () => {
  test("a healthy land-and-sea render has no problems", () => {
    const img = image(1000, (i) =>
      i % 2 === 0 ? [70, 120, 50] : [30, 90, 150],
    );
    const s = summarisePixels(img, 0.4);
    expect(s.problems).toEqual([]);
    expect(s.landColourShare).toBeCloseTo(0.5, 1);
  });

  test("flags blank, black and landless renders", () => {
    expect(
      summarisePixels(
        image(500, () => [0, 0, 0]),
        0.5,
      ).problems,
    ).toEqual(
      expect.arrayContaining(["blank image", "black pixels (shader?)"]),
    );
    const allSea = image(500, (i) => (i % 2 ? [20, 60, 140] : [30, 90, 180]));
    expect(summarisePixels(allSea, 0.5).problems).toContain("no land visible");
    // A pure-ocean map is allowed to show no land.
    expect(summarisePixels(allSea, 0)).toMatchObject({ problems: [] });
  });
});
