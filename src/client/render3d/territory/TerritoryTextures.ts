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
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { OwnerBuffer } from "./OwnerBuffer";

export class TerritoryTextures {
  readonly owners: OwnerBuffer;
  readonly ownerTexture: DataTexture;
  readonly paletteTexture: DataTexture;
  /** Per-tile railroad piece (0 none, 1..6 orientation), see RailroadCache. */
  readonly railTexture: DataTexture;
  private readonly paletteData: Float32Array;
  private readonly railData: Uint8Array;

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

    this.railData = new Uint8Array(width * height);
    this.railTexture = new DataTexture(
      this.railData,
      width,
      height,
      RedFormat,
      UnsignedByteType,
    );
    this.railTexture.unpackAlignment = 1;
    configureNearest(this.railTexture);
    this.railTexture.needsUpdate = true;
  }

  /** Copy railroad state; call when FrameData.railroadDirty. */
  updateRails(railroadState: Uint8Array): void {
    this.railData.set(railroadState.subarray(0, this.railData.length));
    this.railTexture.needsUpdate = true;
  }

  /** Sync ownership from a simulation tick; `changed === null` → full. */
  updateOwners(
    tileState: Uint16Array,
    changed: readonly number[] | null,
    nowMs: number | null = null,
  ): void {
    if (changed === null) this.owners.applyFull(tileState);
    else if (changed.length > 0) {
      this.owners.applyChanged(tileState, changed, nowMs);
    } else return;
    this.flushOwners();
  }

  /** Per frame: end finished conquest animations. */
  expireCaptures(nowMs: number): void {
    if (this.owners.pendingCaptures() === 0) return;
    this.owners.expireCaptures(nowMs);
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
    this.railTexture.dispose();
  }

  private flushOwners(): void {
    const o = this.owners;
    if (!o.isDirty()) return;
    const rowBytes = o.width * 4;
    // three.js uploads each update range as a single row, so ranges are
    // added per dirty row. Past a quarter of the map a full upload is
    // cheaper than many small calls. Several ticks can land before the next
    // render: ranges accumulate until three.js uploads (and clears) them,
    // and once a full upload is pending no ranges are added (an empty range
    // list means "upload everything").
    const full = o.dirtyRows.length > o.height / 4;
    if (full || this.ownerUploadPending === "full") {
      this.ownerTexture.clearUpdateRanges();
      this.ownerUploadPending = "full";
    } else {
      for (const row of o.dirtyRows) {
        this.ownerTexture.addUpdateRange(row * rowBytes, rowBytes);
      }
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
