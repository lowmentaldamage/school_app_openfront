/**
 * AudioEvents — turns per-tick game state into music intensity and unit
 * sound cues for WorldAudio. Pure logic, unit tested.
 */

import type { WorldCue } from "./WorldAudio";

export interface AudioUnit {
  id: number;
  unitType: string;
  ownerID: number;
  pos: number;
  isActive: boolean;
  underConstruction: boolean;
}

/** Tiles gained in one tick that count as a capture worth a sound. */
const CAPTURE_TILES = 40;

/**
 * Music intensity: peace 0.15; fighting another player 0.6; under attack
 * 0.85 (1 when outnumbered at the front).
 */
export function warIntensity(
  incomingTroops: number,
  outgoingVsPlayers: number,
  myTroops: number,
): number {
  if (incomingTroops > 0) {
    return incomingTroops > myTroops * 0.5 ? 1 : 0.85;
  }
  if (outgoingVsPlayers > 0) return 0.6;
  return 0.15;
}

export class AudioEventTracker {
  private readonly known = new Map<
    number,
    { type: string; building: boolean; pos?: number }
  >();
  private lastTiles = -1;
  private first = true;
  private frame = 0;

  /**
   * @param inView whether a tile is on screen (sounds of others' units
   *   only play when you can see them)
   * @returns cues to play this tick
   */
  update(
    units: Iterable<AudioUnit>,
    mySmallID: number | null,
    inView: (pos: number) => boolean,
    myTiles: number,
    war = 0,
  ): WorldCue[] {
    const cues = new Set<WorldCue>();
    const present = new Set<number>();
    let bombers = 0;
    // Anti-air on screen and planes of another owner on screen → flak.
    const aaOwners = new Set<number>();
    const planeOwners = new Set<number>();
    for (const u of units) {
      if (!u.isActive) continue;
      present.add(u.id);
      if (u.unitType === "Bomber") bombers++;
      if (!this.first && inView(u.pos)) {
        if (AA_TYPES.has(u.unitType) && !u.underConstruction) {
          aaOwners.add(u.ownerID);
        } else if (u.unitType === "Bomber" || u.unitType === "Fighter") {
          planeOwners.add(u.ownerID);
        }
      }
      const mine = mySmallID !== null && u.ownerID === mySmallID;
      const prev = this.known.get(u.id);
      if (prev === undefined) {
        this.known.set(u.id, {
          type: u.unitType,
          building: u.underConstruction,
          pos: u.pos,
        });
        if (this.first) continue;
        const heard = mine || inView(u.pos);
        if (u.unitType === "Bomber" && heard) cues.add("bomber");
        else if (u.unitType === "Fighter" && heard) cues.add("fighter");
        else if (u.unitType === "Submarine" && mine) cues.add("torpedo");
        else if (u.unitType === "Shell" && heard) cues.add("gunfire");
        else if (u.unitType === "SAMMissile" && heard) cues.add("flak");
        else if (mine && !u.underConstruction && isStructure(u.unitType)) {
          cues.add(u.unitType === "Radar Station" ? "radar" : "build");
        }
        continue;
      }
      prev.pos = u.pos;
      if (prev.building && !u.underConstruction) {
        prev.building = false;
        if (mine) cues.add(u.unitType === "Radar Station" ? "radar" : "build");
      }
    }
    for (const [id, k] of this.known) {
      if (present.has(id)) continue;
      this.known.delete(id);
      // Bombs landing during an air raid; shells hitting on screen.
      if (k.type === "Artillery Shell" && bombers > 0) cues.add("bomb");
      else if (
        (k.type === "Artillery Shell" || k.type === "Shell") &&
        k.pos !== undefined &&
        inView(k.pos)
      ) {
        cues.add("explosion");
      }
    }
    for (const a of aaOwners) {
      for (const p of planeOwners) {
        if (a !== p) cues.add("flak");
      }
    }
    // Distant rifle and machine-gun crackle while fighting at a front:
    // every 10 frames at 0.6 intensity, every 5 under heavy attack.
    this.frame++;
    if (!this.first && war >= 0.6) {
      const every = war >= 1 ? 5 : war >= 0.85 ? 7 : 10;
      if (this.frame % every === 0) cues.add("skirmish");
    }
    if (
      !this.first &&
      this.lastTiles >= 0 &&
      myTiles - this.lastTiles >= CAPTURE_TILES
    ) {
      cues.add("capture");
    }
    this.lastTiles = myTiles;
    this.first = false;
    return [...cues];
  }
}

const AA_TYPES = new Set(["Flak Gun", "SAM Launcher", "Rail SAM"]);

const STRUCTURE_TYPES = new Set([
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
  "Flak Gun",
]);

function isStructure(type: string): boolean {
  return STRUCTURE_TYPES.has(type);
}
