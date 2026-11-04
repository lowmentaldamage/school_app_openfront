/**
 * DisasterExecution — natural disasters (game option "disasters").
 *
 * One per game. After the spawn phase and a grace period it schedules a
 * disaster every few minutes (DISASTER_INTERVAL ± 30%), picks a kind and a
 * fitting place (volcanoes on mountains, tsunamis on coasts, storms at sea
 * near ships, wildfires on plains, earthquakes anywhere people live),
 * announces it WARNING_TICKS ahead to everyone, then hits: troop losses
 * (capped per player), buildings losing levels, ships sunk or damaged.
 * Never takes land. Seeded from the tick: identical on every client.
 */

import { TileRef } from "@laukolaroser/engine-api/game/GameMap";
import {
  DISASTER_KINDS,
  MessageType,
  Structures,
  UnitType,
  type DisasterFrequency,
  type DisasterKind,
} from "@laukolaroser/engine-api/game/GameTypes";
import { GameUpdateType } from "@laukolaroser/engine-api/game/GameUpdates";
import {
  COAST_TILES,
  DISASTERS,
  disasterGap,
  disasterTroopLoss,
  GRACE_TICKS,
  PULSE_TICKS,
  WARNING_TICKS,
} from "@laukolaroser/engine-lib/disasters/Disasters";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import { zInt } from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** Spelled out so the translation-key checker can see them. */
const WARNING_KEYS: Record<DisasterKind, string> = {
  volcano: "events_display.disaster_warning_volcano",
  earthquake: "events_display.disaster_warning_earthquake",
  tsunami: "events_display.disaster_warning_tsunami",
  storm: "events_display.disaster_warning_storm",
  wildfire: "events_display.disaster_warning_wildfire",
};
const HIT_KEYS: Record<DisasterKind, string> = {
  volcano: "events_display.disaster_hit_volcano",
  earthquake: "events_display.disaster_hit_earthquake",
  tsunami: "events_display.disaster_hit_tsunami",
  storm: "events_display.disaster_hit_storm",
  wildfire: "events_display.disaster_hit_wildfire",
};

const SHIPS = [UnitType.TransportShip, UnitType.TradeShip] as const;
const WARSHIPS = [
  UnitType.Warship,
  UnitType.Destroyer,
  UnitType.Battleship,
  UnitType.Submarine,
  UnitType.Carrier,
] as const;
/** Random tiles tried when looking for a place. */
const PLACE_SAMPLES = 400;

interface ActiveDisaster {
  id: number;
  kind: DisasterKind;
  tile: TileRef;
  strikeAt: number;
  pulsesDone: number;
}

/** What one pulse did (tests read it). */
export interface DisasterResult {
  troopsKilled: number;
  buildingsHit: number;
  shipsSunk: number;
  warshipsHit: number;
}

export function disasterFrequency(mg: Game): DisasterFrequency {
  const gc = mg.config().gameConfig();
  if (gc.tutorial === true) return "off";
  return gc.disasters ?? "off";
}

export class DisasterExecution implements Execution {
  private mg: Game | null = null;
  private nextAt = -1;
  private nextId = 1;
  private active: ActiveDisaster | null = null;
  /** The last pulse's effects (tests). */
  lastResult: DisasterResult | null = null;

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    const freq = disasterFrequency(mg);
    if (freq === "off" || mg.inSpawnPhase()) return;
    if (this.nextAt < 0) {
      this.nextAt = ticks + GRACE_TICKS + this.gap(ticks, freq);
    }
    const a = this.active;
    if (a === null) {
      if (ticks >= this.nextAt) this.announce(ticks);
      return;
    }
    const spec = DISASTERS[a.kind];
    if (ticks < a.strikeAt + a.pulsesDone * PULSE_TICKS) return;
    if (a.pulsesDone === 0) this.send(a, "strike");
    this.lastResult = this.pulse(a, ticks);
    a.pulsesDone++;
    if (a.pulsesDone >= spec.pulses) {
      if (spec.pulses > 1) this.send(a, "end");
      this.active = null;
      this.nextAt = ticks + this.gap(ticks, freq);
    }
  }

  /** Start a disaster now (tests; also used by the scheduler). */
  announce(ticks: number, kind?: DisasterKind, tile?: TileRef): boolean {
    const mg = this.mg!;
    const rand = new PseudoRandom(ticks * 7_919 + this.nextId * 104_729 + 17);
    let pick: { kind: DisasterKind; tile: TileRef } | null = null;
    if (kind !== undefined && tile !== undefined) {
      pick = { kind, tile };
    } else {
      // Try kinds in a random order until one has a fitting place.
      const kinds = [...DISASTER_KINDS];
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = rand.nextInt(0, i + 1);
        [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
      }
      if (kind !== undefined) kinds.unshift(kind);
      for (const k of kinds) {
        const t = this.findPlace(k, rand);
        if (t !== null) {
          pick = { kind: k, tile: t };
          break;
        }
      }
    }
    if (pick === null) {
      // Nowhere fitting (tiny map): try again later.
      this.nextAt = ticks + 600;
      return false;
    }
    this.active = {
      id: this.nextId++,
      kind: pick.kind,
      tile: pick.tile,
      strikeAt: ticks + WARNING_TICKS,
      pulsesDone: 0,
    };
    this.send(this.active, "warning");
    mg.displayMessage(
      WARNING_KEYS[pick.kind],
      MessageType.DISASTER,
      null,
      undefined,
      { x: mg.x(pick.tile), y: mg.y(pick.tile) },
    );
    return true;
  }

  activeDisaster(): Readonly<ActiveDisaster> | null {
    return this.active;
  }

  private gap(ticks: number, freq: Exclude<DisasterFrequency, "off">) {
    const r = new PseudoRandom(ticks * 31 + this.nextId * 977 + 5);
    return disasterGap(freq, r.nextInt(0, 1000));
  }

  private send(a: ActiveDisaster, phase: "warning" | "strike" | "end") {
    this.mg!.addUpdate({
      type: GameUpdateType.DisasterEvent,
      id: a.id,
      kind: a.kind,
      tile: a.tile,
      radius: DISASTERS[a.kind].radius,
      phase,
      strikeAt: a.strikeAt,
    });
  }

  /** A random tile that suits `kind`, or null. */
  private findPlace(kind: DisasterKind, rand: PseudoRandom): TileRef | null {
    const mg = this.mg!;
    if (kind === "storm") {
      // Where ships sail, else open sea.
      const ships = mg.units([...SHIPS, ...WARSHIPS]);
      if (ships.length > 0) {
        return ships[rand.nextInt(0, ships.length)].tile();
      }
    }
    let best: TileRef | null = null;
    let bestScore = -1;
    for (let i = 0; i < PLACE_SAMPLES; i++) {
      const t = mg.ref(
        rand.nextInt(0, mg.width()),
        rand.nextInt(0, mg.height()),
      );
      const land = mg.isLand(t);
      const mag = land ? mg.magnitude(t) : 0;
      const owned = land && mg.owner(t).isPlayer();
      let score = -1;
      switch (kind) {
        case "volcano":
          if (land && mag >= 20) score = mag;
          break;
        case "earthquake":
          if (land) score = owned ? 2 : 1;
          break;
        case "tsunami":
          if (mg.isOceanShore(t)) score = owned ? 2 : 1;
          break;
        case "storm":
          if (mg.isOcean(t)) score = 1;
          break;
        case "wildfire":
          if (land && mag < 20) score = owned ? 2 : 1;
          break;
      }
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  private nearCoast(t: TileRef): boolean {
    const mg = this.mg!;
    const x = mg.x(t);
    const y = mg.y(t);
    for (let d = 1; d <= COAST_TILES; d++) {
      for (const [dx, dy] of [
        [d, 0],
        [-d, 0],
        [0, d],
        [0, -d],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!mg.isValidCoord(nx, ny)) continue;
        if (mg.isOcean(mg.ref(nx, ny))) return true;
      }
    }
    return mg.isOceanShore(t);
  }

  /** One pulse of damage. */
  private pulse(a: ActiveDisaster, ticks: number): DisasterResult {
    const mg = this.mg!;
    const spec = DISASTERS[a.kind];
    const rand = new PseudoRandom(ticks * 131 + a.id * 7_331 + a.pulsesDone);
    const res: DisasterResult = {
      troopsKilled: 0,
      buildingsHit: 0,
      shipsSunk: 0,
      warshipsHit: 0,
    };
    const hits = (t: TileRef) => !spec.coastOnly || this.nearCoast(t);

    // Troops: per player, by the share of their land in the area.
    const tilesHit = new Map<Player, number>();
    for (const t of mg.circleSearch(a.tile, spec.radius)) {
      if (!mg.isLand(t)) continue;
      const o = mg.owner(t);
      if (!o.isPlayer() || !hits(t)) continue;
      tilesHit.set(o, (tilesHit.get(o) ?? 0) + 1);
    }
    const lost = new Map<Player, number>();
    for (const [p, n] of tilesHit) {
      const loss = disasterTroopLoss(spec, p.troops(), p.numTilesOwned(), n);
      if (loss > 0) {
        const k = p.removeTroops(loss);
        res.troopsKilled += k;
        lost.set(p, k);
      }
    }

    // Buildings: may lose a level; level 1 only falls to volcanoes.
    const perPulse = Math.floor(spec.buildingHitPerMille / spec.pulses);
    if (perPulse > 0) {
      for (const { unit } of mg.nearbyUnits(
        a.tile,
        spec.radius,
        Structures.types,
      )) {
        if (!unit.isActive() || !hits(unit.tile())) continue;
        if (rand.nextInt(0, 1000) >= perPulse) continue;
        if (unit.level() > 1 || spec.destroysBuildings) {
          unit.decreaseLevel();
          res.buildingsHit++;
        }
      }
    }

    // Ships in the area: small boats may sink, warships take damage.
    const sink = Math.floor(spec.shipSinkPerMille / spec.pulses);
    if (sink > 0) {
      for (const { unit } of mg.nearbyUnits(a.tile, spec.radius, [...SHIPS])) {
        if (!unit.isActive()) continue;
        if (rand.nextInt(0, 1000) >= sink) continue;
        unit.delete(true);
        res.shipsSunk++;
      }
    }
    if (spec.warshipDamage > 0) {
      const dmg = Math.floor(spec.warshipDamage / spec.pulses);
      for (const { unit } of mg.nearbyUnits(a.tile, spec.radius, [
        ...WARSHIPS,
      ])) {
        if (!unit.isActive()) continue;
        unit.modifyHealth(-dmg);
        res.warshipsHit++;
      }
    }

    if (a.pulsesDone === 0 || a.pulsesDone === spec.pulses - 1) {
      for (const [p, k] of lost) {
        mg.displayMessage(
          HIT_KEYS[a.kind],
          MessageType.DISASTER,
          p.id(),
          undefined,
          { troops: k },
        );
      }
    }
    return res;
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return DisasterSnapshot.write({
      initialized: this.mg !== null,
      nextAt: this.nextAt,
      nextId: this.nextId,
      active:
        this.active === null
          ? null
          : {
              id: this.active.id,
              kind: this.active.kind,
              tile: this.active.tile,
              strikeAt: this.active.strikeAt,
              pulsesDone: this.active.pulsesDone,
            },
    });
  }

  restoreSnapshot(s: DisasterState, r: SnapshotReader): void {
    this.mg = s.initialized ? r.game : null;
    this.nextAt = s.nextAt;
    this.nextId = s.nextId;
    this.active = s.active === null ? null : { ...s.active };
    this.lastResult = null;
  }
}

const DisasterStateSchema = z.object({
  initialized: z.boolean(),
  nextAt: zInt(),
  nextId: zInt(),
  active: z
    .object({
      id: zInt(),
      kind: z.enum(DISASTER_KINDS),
      tile: zInt(),
      strikeAt: zInt(),
      pulsesDone: zInt(),
    })
    .nullable(),
});
type DisasterState = z.infer<typeof DisasterStateSchema>;

export const DisasterSnapshot = execSnapshotType({
  name: "Disaster",
  version: 1,
  schema: DisasterStateSchema,
  cls: () => DisasterExecution,
});
