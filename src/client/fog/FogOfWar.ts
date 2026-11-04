/**
 * FogOfWar — which enemy units and buildings a player can see.
 *
 * The map, territory and borders are always visible (everyone knows the
 * political map). Enemy units and buildings only show inside the sight of
 * the player and their allies: near their land, around their ships,
 * planes, trains and buildings, and in their radar circles. Buildings stay
 * on the map once seen (last known position). Nukes and missiles in flight
 * are always shown, so incoming strikes can be answered.
 *
 * Display only: every client still runs the full simulation, so this is a
 * view filter, not a security boundary. Works on a coarse cell grid and is
 * updated incrementally from changed tiles, so it costs little per tick.
 * No WebGL, unit tested directly.
 */

import { radarRange } from "@laukolaroser/engine-lib/defense/Radar";
import { OWNER_MASK } from "../render/gl/utils/TileCodec";

/** Tiles per fog cell edge. */
export const FOG_CELL = 8;
/** Sight beyond friendly land, in cells (≈ 16 tiles). */
const LAND_SIGHT_CELLS = 2;

/** Sight radius in tiles by unit type (friendly units). */
const SIGHT: Readonly<Record<string, number>> = {
  Warship: 26,
  Destroyer: 30,
  Battleship: 26,
  Submarine: 18,
  "Aircraft Carrier": 34,
  Transport: 12,
  "Trade Ship": 10,
  Bomber: 22,
  Fighter: 22,
  Train: 10,
  "Armored Train": 14,
  "Troop Train": 10,
  "Rail SAM": 14,
  Port: 30,
  "Defense Post": 20,
  "SAM Launcher": 24,
  Airbase: 24,
  "Oil Rig": 16,
};

/** Never hidden: strikes in flight. */
const ALWAYS_VISIBLE = new Set<string>([
  "Atom Bomb",
  "Hydrogen Bomb",
  "MIRV",
  "MIRV Warhead",
  "SAMMissile",
  "Rocket",
  "Shell",
  "Artillery Shell",
]);

const STRUCTURES = new Set<string>([
  "City",
  "Port",
  "Factory",
  "Defense Post",
  "SAM Launcher",
  "Missile Silo",
  "Gold Mine",
  "Market",
  "Oil Rig",
  "Airbase",
  "Radar Station",
  "Fort",
  "Coastal Battery",
]);

export interface FogUnit {
  id: number;
  unitType: string;
  ownerID: number;
  pos: number;
  isActive: boolean;
  level?: number;
}

export class FogOfWar {
  readonly cellsW: number;
  readonly cellsH: number;
  private readonly owners: Uint16Array;
  /** Friendly tiles per cell. */
  private readonly landCount: Uint32Array;
  private readonly visible: Uint8Array;
  private readonly scratch: Uint8Array;
  private friendly = new Uint8Array(OWNER_MASK + 1);
  private friendlyKey = "";
  private readonly seenStructures = new Set<number>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cellsW = Math.ceil(width / FOG_CELL);
    this.cellsH = Math.ceil(height / FOG_CELL);
    const n = this.cellsW * this.cellsH;
    this.owners = new Uint16Array(width * height);
    this.landCount = new Uint32Array(n);
    this.visible = new Uint8Array(n);
    this.scratch = new Uint8Array(n);
  }

  /** The player's own smallID and its allies'. Recounts when it changes. */
  setFriendly(ids: readonly number[]): void {
    const key = [...ids].sort((a, b) => a - b).join(",");
    if (key === this.friendlyKey) return;
    this.friendlyKey = key;
    this.friendly = new Uint8Array(OWNER_MASK + 1);
    for (const id of ids) if (id > 0) this.friendly[id & OWNER_MASK] = 1;
    this.landCount.fill(0);
    const w = this.width;
    for (let i = 0; i < this.owners.length; i++) {
      if (this.friendly[this.owners[i]]) this.landCount[this.cellOf(i, w)]++;
    }
  }

  /** Mirror tile ownership; `changed === null` means every tile. */
  updateOwners(tileState: Uint16Array, changed: readonly number[] | null) {
    const w = this.width;
    if (changed === null) {
      this.landCount.fill(0);
      for (let i = 0; i < this.owners.length; i++) {
        const o = tileState[i] & OWNER_MASK;
        this.owners[i] = o;
        if (this.friendly[o]) this.landCount[this.cellOf(i, w)]++;
      }
      return;
    }
    for (let k = 0; k < changed.length; k++) {
      const i = changed[k];
      const o = tileState[i] & OWNER_MASK;
      const before = this.owners[i];
      if (o === before) continue;
      this.owners[i] = o;
      const c = this.cellOf(i, w);
      if (this.friendly[before]) this.landCount[c]--;
      if (this.friendly[o]) this.landCount[c]++;
    }
  }

  /** Recompute what is in sight. Call once per tick, before isUnitVisible. */
  computeVisibility(units: Iterable<FogUnit>): void {
    const cw = this.cellsW;
    const ch = this.cellsH;
    const r = LAND_SIGHT_CELLS;
    // Friendly land, dilated (separable square max filter).
    const s = this.scratch;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let v = 0;
        for (let dx = -r; dx <= r && !v; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < cw && this.landCount[y * cw + xx] > 0) v = 1;
        }
        s[y * cw + x] = v;
      }
    }
    const vis = this.visible;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let v = 0;
        for (let dy = -r; dy <= r && !v; dy++) {
          const yy = y + dy;
          if (yy >= 0 && yy < ch && s[yy * cw + x]) v = 1;
        }
        vis[y * cw + x] = v;
      }
    }
    // Sight circles around friendly units and buildings.
    const w = this.width;
    for (const u of units) {
      if (!u.isActive || !this.friendly[u.ownerID & OWNER_MASK]) continue;
      const range =
        u.unitType === "Radar Station"
          ? radarRange(u.level ?? 1)
          : (SIGHT[u.unitType] ?? (STRUCTURES.has(u.unitType) ? 12 : 0));
      if (range <= 0) continue;
      this.stamp(u.pos % w, Math.floor(u.pos / w), range);
    }
  }

  /** Is the tile in sight right now? */
  isTileVisible(pos: number): boolean {
    return this.visible[this.cellOf(pos, this.width)] === 1;
  }

  /**
   * Should this unit be drawn? Friendly units always; strikes in flight
   * always; buildings once seen; everything else only while in sight.
   */
  isUnitVisible(u: FogUnit): boolean {
    if (this.friendly[u.ownerID & OWNER_MASK]) return true;
    if (ALWAYS_VISIBLE.has(u.unitType)) return true;
    const inSight = this.isTileVisible(u.pos);
    if (STRUCTURES.has(u.unitType)) {
      if (inSight) this.seenStructures.add(u.id);
      return inSight || this.seenStructures.has(u.id);
    }
    return inSight;
  }

  /** Visible cells (for tests and a future overlay). */
  visibleCellCount(): number {
    let n = 0;
    for (let i = 0; i < this.visible.length; i++) n += this.visible[i];
    return n;
  }

  private cellOf(i: number, w: number): number {
    const x = i % w;
    const y = (i - x) / w;
    return ((y / FOG_CELL) | 0) * this.cellsW + ((x / FOG_CELL) | 0);
  }

  private stamp(tx: number, ty: number, range: number): void {
    const cw = this.cellsW;
    const ch = this.cellsH;
    const cx = (tx + 0.5) / FOG_CELL;
    const cy = (ty + 0.5) / FOG_CELL;
    const rc = range / FOG_CELL;
    const r2 = rc * rc;
    const x0 = Math.max(0, Math.floor(cx - rc));
    const x1 = Math.min(cw - 1, Math.floor(cx + rc));
    const y0 = Math.max(0, Math.floor(cy - rc));
    const y1 = Math.min(ch - 1, Math.floor(cy + rc));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) this.visible[y * cw + x] = 1;
      }
    }
  }
}
