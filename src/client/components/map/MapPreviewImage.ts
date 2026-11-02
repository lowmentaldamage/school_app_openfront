/**
 * Map picture choice for the menus: the 3D-rendered preview
 * (preview3d.webp, made by scripts/maps-3d.cjs) when the 3D view is on,
 * else the flat thumbnail. A map without a 3D preview falls back to its
 * thumbnail through the image's error handler.
 */

import { isWorld3DEnabled } from "../../render3d/World3DFlag";

export interface MapImagePaths {
  webpPath: string;
  preview3dPath?: string;
}

/** The image to show first. */
export function mapImageSrc(d: MapImagePaths): string {
  return isWorld3DEnabled() && d.preview3dPath !== undefined
    ? d.preview3dPath
    : d.webpPath;
}

/**
 * `@error` handler: swap a failed 3D preview for the flat thumbnail (once,
 * so a missing thumbnail cannot loop).
 */
export function fallbackToThumbnail(thumbnail: string): (e: Event) => void {
  return (e: Event) => {
    const img = e.currentTarget as HTMLImageElement | null;
    if (img === null || img.dataset.fellBack === "1") return;
    img.dataset.fellBack = "1";
    img.src = thumbnail;
  };
}
