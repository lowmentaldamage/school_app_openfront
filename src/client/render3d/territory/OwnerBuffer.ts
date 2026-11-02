/**
 * OwnerBuffer — CPU mirror of the per-tile ownership texture (RGBA8).
 *
 * Encodes the simulation's tile state (see render/gl/utils/TileCodec.ts) as
 *   R = owner smallID & 0xff
 *   G = owner smallID >> 8      (smallIDs are 12-bit)
 *   B = 255 if the tile carries fallout, else 0
 *   A = 255 if the tile carries a defense bonus, else 0
 *
 * RGBA8 is used (rather than a 2-byte format) because three.js partial
 * texture uploads (`Texture.addUpdateRange`) only support 4-byte texels.
 *
 * Changes are tracked as a dirty row range so a tick that touches a handful
 * of rows uploads only those rows. This module has no three.js dependency
 * and is unit tested directly against simulation tile state.
 */

import { FALLOUT_BIT, OWNER_MASK } from "../../render/gl/utils/TileCodec";

const DEFENSE_BIT = 1 << 14;

export class OwnerBuffer {
  readonly data: Uint8Array;
  /** Inclusive dirty row range; dirtyMin > dirtyMax means clean. */
  dirtyMin = Number.POSITIVE_INFINITY;
  dirtyMax = Number.NEGATIVE_INFINITY;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  /** Re-encode every tile (first tick, seek, context restore). */
  applyFull(tileState: Uint16Array): void {
    const n = this.width * this.height;
    if (tileState.length < n) {
      throw new Error(
        `OwnerBuffer: tileState has ${tileState.length} entries, expected ${n}`,
      );
    }
    for (let i = 0; i < n; i++) this.encode(i, tileState[i]);
    this.dirtyMin = 0;
    this.dirtyMax = this.height - 1;
  }

  /** Re-encode only the listed tiles and widen the dirty row range. */
  applyChanged(tileState: Uint16Array, changed: readonly number[]): void {
    const w = this.width;
    for (let k = 0; k < changed.length; k++) {
      const ref = changed[k];
      this.encode(ref, tileState[ref]);
      const row = (ref / w) | 0;
      if (row < this.dirtyMin) this.dirtyMin = row;
      if (row > this.dirtyMax) this.dirtyMax = row;
    }
  }

  isDirty(): boolean {
    return this.dirtyMin <= this.dirtyMax;
  }

  clearDirty(): void {
    this.dirtyMin = Number.POSITIVE_INFINITY;
    this.dirtyMax = Number.NEGATIVE_INFINITY;
  }

  ownerAt(ref: number): number {
    const o = ref * 4;
    return this.data[o] | (this.data[o + 1] << 8);
  }

  private encode(ref: number, state: number): void {
    const owner = state & OWNER_MASK;
    const o = ref * 4;
    this.data[o] = owner & 0xff;
    this.data[o + 1] = owner >> 8;
    this.data[o + 2] = state & FALLOUT_BIT ? 255 : 0;
    this.data[o + 3] = state & DEFENSE_BIT ? 255 : 0;
  }
}
