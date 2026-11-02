/**
 * GPU side of territory ownership: the per-tile owner texture and the player
 * palette texture. Both are read by the terrain shader (TerritoryShader).
 *
 * The palette is the same Float32Array the 2D renderer uses (written by
 * WebGLFrameBuilder via PlayerPalette.writePaletteEntry): row 0 holds each
 * player's territory fill, row 1 its border colour, indexed by smallID.
 */

import {
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { OwnerBuffer } from "./OwnerBuffer";

export class TerritoryTextures {
  readonly owners: OwnerBuffer;
  readonly ownerTexture: DataTexture;
  readonly paletteTexture: DataTexture;
  private readonly paletteData: Float32Array;

  constructor(
    width: number,
    height: number,
    readonly paletteSize: number,
  ) {
    this.owners = new OwnerBuffer(width, height);
    this.ownerTexture = new DataTexture(
      this.owners.data,
      width,
      height,
      RGBAFormat,
      UnsignedByteType,
    );
    configureNearest(this.ownerTexture);
    // The first upload of a texture always sends the whole image.
    this.ownerTexture.needsUpdate = true;
    this.ownerTexture.onUpdate = () => {
      this.ownerUploadPending = "none";
    };

    this.paletteData = new Float32Array(paletteSize * 2 * 4);
    this.paletteTexture = new DataTexture(
      this.paletteData,
      paletteSize,
      2,
      RGBAFormat,
      FloatType,
    );
    configureNearest(this.paletteTexture);
  }

  /** Sync ownership from a simulation tick; `changed === null` → full. */
  updateOwners(
    tileState: Uint16Array,
    changed: readonly number[] | null,
  ): void {
    if (changed === null) this.owners.applyFull(tileState);
    else if (changed.length > 0) this.owners.applyChanged(tileState, changed);
    else return;
    this.flushOwners();
  }

  /** Copy the 2D renderer's palette (fill row + border row). */
  updatePalette(palette: Float32Array): void {
    const n = Math.min(palette.length, this.paletteData.length);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (this.paletteData[i] !== palette[i]) {
        this.paletteData[i] = palette[i];
        changed = true;
      }
    }
    if (changed) this.paletteTexture.needsUpdate = true;
  }

  dispose(): void {
    this.ownerTexture.dispose();
    this.paletteTexture.dispose();
  }

  private flushOwners(): void {
    const o = this.owners;
    if (!o.isDirty()) return;
    const rowBytes = o.width * 4;
    const full = o.dirtyMin === 0 && o.dirtyMax === o.height - 1;
    // Several ticks can land before the next render. Ranges accumulate until
    // three.js uploads (and clears) them; once a full upload is pending, no
    // ranges are added, since an empty range list means "upload everything".
    if (full || this.ownerUploadPending === "full") {
      this.ownerTexture.clearUpdateRanges();
      this.ownerUploadPending = "full";
    } else {
      this.ownerTexture.addUpdateRange(
        o.dirtyMin * rowBytes,
        (o.dirtyMax - o.dirtyMin + 1) * rowBytes,
      );
      this.ownerUploadPending = "partial";
    }
    this.ownerTexture.needsUpdate = true;
    o.clearDirty();
  }

  private ownerUploadPending: "none" | "partial" | "full" = "full";
}

function configureNearest(t: DataTexture): void {
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
}
