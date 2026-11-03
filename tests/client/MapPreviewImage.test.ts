import {
  fallbackToThumbnail,
  mapImageSrc,
} from "../../src/client/components/map/MapPreviewImage";

describe("MapPreviewImage", () => {
  const paths = { webpPath: "/t.webp", preview3dPath: "/p3d.webp" };

  test("uses the 3D preview when the 3D view is on (default)", () => {
    localStorage.removeItem("laukolaroser.renderer");
    expect(mapImageSrc(paths)).toBe("/p3d.webp");
    expect(mapImageSrc({ webpPath: "/t.webp" })).toBe("/t.webp");
  });

  test("uses the flat thumbnail in the 2D view", () => {
    localStorage.setItem("laukolaroser.renderer", "2d");
    expect(mapImageSrc(paths)).toBe("/t.webp");
    localStorage.removeItem("laukolaroser.renderer");
  });

  test("falls back to the thumbnail once on error", () => {
    const img = document.createElement("img");
    img.src = "/p3d.webp";
    const onError = fallbackToThumbnail("/t.webp");
    img.addEventListener("error", onError);
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe("/t.webp");
    img.src = "/other.webp";
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe("/other.webp");
  });
});
