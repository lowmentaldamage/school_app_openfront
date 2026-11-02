/**
 * Feature flag for the 3D world view. Kept in its own module (no three.js
 * imports) so checking it never pulls the 3D renderer into a bundle.
 */

const STORAGE_KEY = "laukolaroser.renderer";

/**
 * The 3D view is opt-in while it is being built out: `?renderer=3d` in the
 * URL (persisted to localStorage), `?renderer=2d` to switch back.
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
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "3d";
  } catch {
    return false;
  }
}
