/**
 * Feature flag for the 3D world view. Kept in its own module (no three.js
 * imports) so checking it never pulls the 3D renderer into a bundle.
 */

const STORAGE_KEY = "laukolaroser.renderer";

/**
 * The 3D view is the default. `?renderer=2d` in the URL switches to the
 * classic flat map (remembered in localStorage); `?renderer=3d` switches
 * back. If the 3D view fails to start, the game falls back to 2D.
 */
export function isWorld3DEnabled(): boolean {
  try {
    const param = new URLSearchParams(globalThis.location?.search ?? "").get(
      "renderer",
    );
    if (param === "3d" || param === "2d") {
      globalThis.localStorage?.setItem(STORAGE_KEY, param);
      return param === "3d";
    }
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== "2d";
  } catch {
    return true;
  }
}
