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
    { type: string; building: boolean }
  >();
  private lastTiles = -1;
  private first = true;

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
  ): WorldCue[] {
    const cues = new Set<WorldCue>();
    const present = new Set<number>();
    let bombers = 0;
    for (const u of units) {
      if (!u.isActive) continue;
      present.add(u.id);
      if (u.unitType === "Bomber") bombers++;
      const mine = mySmallID !== null && u.ownerID === mySmallID;
      const prev = this.known.get(u.id);
      if (prev === undefined) {
        this.known.set(u.id, {
          type: u.unitType,
          building: u.underConstruction,
        });
        if (this.first) continue;
        const heard = mine || inView(u.pos);
        if (u.unitType === "Bomber" && heard) cues.add("bomber");
        else if (u.unitType === "Fighter" && heard) cues.add("fighter");
        else if (u.unitType === "Submarine" && mine) cues.add("torpedo");
        else if (mine && !u.underConstruction && isStructure(u.unitType)) {
          cues.add(u.unitType === "Radar Station" ? "radar" : "build");
        }
        continue;
      }
      if (prev.building && !u.underConstruction) {
        prev.building = false;
        if (mine) cues.add(u.unitType === "Radar Station" ? "radar" : "build");
      }
    }
    for (const [id, k] of this.known) {
      if (present.has(id)) continue;
      this.known.delete(id);
      // Bombs landing during an air raid.
      if (k.type === "Artillery Shell" && bombers > 0) cues.add("bomb");
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
]);

function isStructure(type: string): boolean {
  return STRUCTURE_TYPES.has(type);
}
