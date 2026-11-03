/**
 * OwnerBuffer — CPU mirror of the per-tile ownership texture (RGBA8).
 *
 * Encodes the simulation's tile state (see render/gl/utils/TileCodec.ts) as
 *   R = owner smallID & 0xff
 *   G = owner smallID >> 8      (smallIDs are 12-bit)
 *   B = bit 7: fallout; bits 0-6: capture stamp, high 7 bits
 *   A = bit 7: defense bonus; bits 0-6: capture stamp, low 7 bits
 *
 * The 14-bit capture stamp (0 = none) marks a tile that just changed
 * owner, so the terrain shader can play the conquest animation without an
 * extra texture (see captureStampAt / CAPTURE_*). Stamps are cleared again
 * by expireCaptures() once the animation is over.
 *
 * RGBA8 is used (rather than a 2-byte format) because three.js partial
 * texture uploads (`Texture.addUpdateRange`) only support 4-byte texels.
 *
 * Changes are tracked per row (three.js partial texture uploads are
 * single-row), so a tick that touches a handful of rows uploads only those
 * rows. This module has no three.js dependency
 * and is unit tested directly against simulation tile state.
 */

import { FALLOUT_BIT, OWNER_MASK } from "../../render/gl/utils/TileCodec";

const DEFENSE_BIT = 1 << 14;

/** Capture stamps tick 20 times per second (50 ms). */
export const CAPTURE_STAMP_MS = 50;
/** Stamps run 1..CAPTURE_STAMP_PERIOD; 0 means "not animating". */
export const CAPTURE_STAMP_PERIOD = 16383;
/** How long a capture animates, and when its stamp is cleared. */
export const CAPTURE_ANIM_MS = 900;

/** The stamp for a moment in time (1..CAPTURE_STAMP_PERIOD). */
export function captureStamp(nowMs: number): number {
  return (Math.floor(nowMs / CAPTURE_STAMP_MS) % CAPTURE_STAMP_PERIOD) + 1;
}

export class OwnerBuffer {
  readonly data: Uint8Array;
  /** Inclusive dirty row range; dirtyMin > dirtyMax means clean. */
  dirtyMin = Number.POSITIVE_INFINITY;
  dirtyMax = Number.NEGATIVE_INFINITY;
  /** Rows changed since the last clearDirty(), each listed once. */
  readonly dirtyRows: number[] = [];
  private readonly rowFlag: Uint8Array;
  /** Capture animations to clear: tile, its stamp, and when (FIFO). */
  private capRefs: number[] = [];
  private capStamps: number[] = [];
  private capExpiry: number[] = [];
  private capHead = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
    this.rowFlag = new Uint8Array(height);
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
    for (let r = 0; r < this.height; r++) this.markRow(r);
  }

  /**
   * Re-encode only the listed tiles and widen the dirty row range. With a
   * `nowMs`, tiles whose owner changed get a capture stamp (animation).
   */
  applyChanged(
    tileState: Uint16Array,
    changed: readonly number[],
    nowMs: number | null = null,
  ): void {
    const w = this.width;
    const stamp = nowMs === null ? 0 : captureStamp(nowMs);
    const expiry = (nowMs ?? 0) + CAPTURE_ANIM_MS;
    for (let k = 0; k < changed.length; k++) {
      const ref = changed[k];
      const before = this.ownerAt(ref);
      this.encode(ref, tileState[ref]);
      if (stamp !== 0 && this.ownerAt(ref) !== before) {
        this.setStamp(ref, stamp);
        this.capRefs.push(ref);
        this.capStamps.push(stamp);
        this.capExpiry.push(expiry);
      }
      const row = (ref / w) | 0;
      if (row < this.dirtyMin) this.dirtyMin = row;
      if (row > this.dirtyMax) this.dirtyMax = row;
      this.markRow(row);
    }
  }

  /** Clear the stamps of finished capture animations. */
  expireCaptures(nowMs: number): void {
    const w = this.width;
    let h = this.capHead;
    const n = this.capRefs.length;
    while (h < n && this.capExpiry[h] <= nowMs) {
      const ref = this.capRefs[h];
      // A newer capture of the same tile keeps its own stamp.
      if (this.captureStampAt(ref) === this.capStamps[h]) {
        this.setStamp(ref, 0);
        const row = (ref / w) | 0;
        if (row < this.dirtyMin) this.dirtyMin = row;
        if (row > this.dirtyMax) this.dirtyMax = row;
        this.markRow(row);
      }
      h++;
    }
    if (h === n) {
      this.capRefs.length = 0;
      this.capStamps.length = 0;
      this.capExpiry.length = 0;
      h = 0;
    } else if (h > 4096 && h > n / 2) {
      this.capRefs = this.capRefs.slice(h);
      this.capStamps = this.capStamps.slice(h);
      this.capExpiry = this.capExpiry.slice(h);
      h = 0;
    }
    this.capHead = h;
  }

  /** Capture animations still running (for tests and stats). */
  pendingCaptures(): number {
    return this.capRefs.length - this.capHead;
  }

  captureStampAt(ref: number): number {
    const o = ref * 4;
    return ((this.data[o + 2] & 127) << 7) | (this.data[o + 3] & 127);
  }

  private setStamp(ref: number, stamp: number): void {
    const o = ref * 4;
    this.data[o + 2] = (this.data[o + 2] & 128) | ((stamp >> 7) & 127);
    this.data[o + 3] = (this.data[o + 3] & 128) | (stamp & 127);
  }

  isDirty(): boolean {
    return this.dirtyMin <= this.dirtyMax;
  }

  clearDirty(): void {
    this.dirtyMin = Number.POSITIVE_INFINITY;
    this.dirtyMax = Number.NEGATIVE_INFINITY;
    for (const r of this.dirtyRows) this.rowFlag[r] = 0;
    this.dirtyRows.length = 0;
  }

  private markRow(row: number): void {
    if (this.rowFlag[row] === 0) {
      this.rowFlag[row] = 1;
      this.dirtyRows.push(row);
    }
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
    // Keep any running capture stamp in the low 7 bits.
    this.data[o + 2] =
      (state & FALLOUT_BIT ? 128 : 0) | (this.data[o + 2] & 127);
    this.data[o + 3] =
      (state & DEFENSE_BIT ? 128 : 0) | (this.data[o + 3] & 127);
  }
}
