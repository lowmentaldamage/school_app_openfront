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
  GameType,
  MessageType,
  Structures,
  UnitType,
  type DisasterFrequency,
  type DisasterKind,
} from "@laukolaroser/engine-api/game/GameTypes";
import { GameUpdateType } from "@laukolaroser/engine-api/game/GameUpdates";
import {
  canTriggerDisaster,
  disasterKindOrder,
  COAST_TILES,
  CORE_PERCENT,
  DISASTERS,
  disasterGap,
  disasterTroopLoss,
  GRACE_TICKS,
  PULSE_TICKS,
  WARNING_TICKS,
} from "@laukolaroser/engine-lib/disasters/Disasters";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
} from "@laukolaroser/engine-lib/snapshot/SnapshotType";
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

/** Ids of disasters set off by hand start here (never clash with ids 1..). */
const TRIGGERED_ID_BASE = 1_000_000;

export class DisasterExecution implements Execution {
  private mg: Game | null = null;
  private nextAt = -1;
  private nextId = 1;
  private active: ActiveDisaster | null = null;
  /** One disaster set off by hand (trigger_disaster), then done. */
  private oneShot: DisasterKind | null = null;
  private done = false;
  /** The last pulse's effects (tests). */
  lastResult: DisasterResult | null = null;
  /** True when a trigger_disaster was refused (not allowed). */
  refused = false;

  /**
   * Without arguments: the scheduler (one per game). With a player and a
   * kind: that disaster at once (the "test disaster" button), if allowed.
   */
  constructor(
    private triggeredBy: Player | null = null,
    kind: DisasterKind | null = null,
  ) {
    this.oneShot = triggeredBy !== null ? kind : null;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.triggeredBy === null || this.oneShot === null) return;
    const gc = mg.config().gameConfig();
    const allowed = canTriggerDisaster(
      gc.gameType === GameType.Singleplayer,
      this.triggeredBy.isLobbyCreator(),
      gc.hostCheats !== undefined && gc.hostCheats !== null,
    );
    if (!allowed || gc.tutorial === true) {
      this.refused = true;
      this.done = true;
      return;
    }
    this.nextId = TRIGGERED_ID_BASE + ticks;
    // At the triggering player's own land when possible, else anywhere fitting.
    const rand = new PseudoRandom(ticks * 13 + 7);
    const own = this.triggeredBy.tiles();
    let tile: TileRef | undefined;
    if (this.oneShot !== "storm" && own.size > 0) {
      const arr = Array.from(own);
      for (let i = 0; i < 40 && tile === undefined; i++) {
        const t = arr[rand.nextInt(0, arr.length)];
        if (this.fits(this.oneShot, t)) tile = t;
      }
    }
    if (!this.announce(ticks, this.oneShot, tile)) this.done = true;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    if (this.done) return;
    if (this.oneShot !== null) {
      this.step(ticks, "frequent");
      if (this.active === null) this.done = true;
      return;
    }
    const freq = disasterFrequency(mg);
    if (freq === "off" || mg.inSpawnPhase()) return;
    this.step(ticks, freq);
  }

  private step(ticks: number, freq: Exclude<DisasterFrequency, "off">): void {
    const a = this.active;
    if (a === null) {
      if (this.oneShot !== null) return;
      if (this.nextAt < 0) {
        this.nextAt = ticks + GRACE_TICKS + this.gap(ticks, freq);
      }
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
    } else if (kind !== undefined && this.oneShot !== null) {
      // A hand-triggered kind: that kind only.
      const t = this.findPlace(kind, rand);
      if (t !== null) pick = { kind, tile: t };
    } else {
      // A kind by weight first, the others as fallbacks.
      const kinds = disasterKindOrder(rand.nextInt(0, 1000));
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

  /** Whether `t` suits `kind` (same rules as findPlace). */
  private fits(kind: DisasterKind, t: TileRef): boolean {
    const mg = this.mg!;
    const land = mg.isLand(t);
    const mag = land ? mg.magnitude(t) : 0;
    switch (kind) {
      case "volcano":
        return land && mag >= 20 && mag < 30;
      case "earthquake":
        return land;
      case "tsunami":
        return mg.isOceanShore(t);
      case "storm":
        return mg.isOcean(t);
      case "wildfire":
        return land && mag < 20;
    }
  }

  /** A random tile that suits `kind`, or null. */
  private findPlace(kind: DisasterKind, rand: PseudoRandom): TileRef | null {
    const mg = this.mg!;
    // Most quakes, fires and tsunamis hit where people live: near a
    // random city, factory or port (a port for a tsunami).
    if (
      (kind === "earthquake" || kind === "wildfire" || kind === "tsunami") &&
      rand.nextInt(0, 100) < 70
    ) {
      const near = mg.units(
        kind === "tsunami"
          ? [UnitType.Port]
          : [UnitType.City, UnitType.Factory, UnitType.Port],
      );
      if (near.length > 0) {
        const base = near[rand.nextInt(0, near.length)].tile();
        for (let i = 0; i < 30; i++) {
          const x = mg.x(base) + rand.nextInt(-8, 9);
          const y = mg.y(base) + rand.nextInt(-8, 9);
          if (!mg.isValidCoord(x, y)) continue;
          const t = mg.ref(x, y);
          if (this.fits(kind, t)) return t;
        }
      }
    }
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
          // Real mountains (not the impassable ice caps), lived-in first.
          if (land && mag >= 20 && mag < 30) score = owned ? 2 : 1;
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

    // Buildings: may lose a level. Level 1 falls only near the centre
    // (anywhere for a volcano).
    const perPulse = Math.floor(spec.buildingHitPerMille / spec.pulses);
    const core = Math.floor((spec.radius * CORE_PERCENT) / 100);
    if (perPulse > 0) {
      for (const { unit, distSquared } of mg.nearbyUnits(
        a.tile,
        spec.radius,
        Structures.types,
      )) {
        if (!unit.isActive() || !hits(unit.tile())) continue;
        if (rand.nextInt(0, 1000) >= perPulse) continue;
        if (
          unit.level() > 1 ||
          spec.destroysBuildings ||
          distSquared <= core * core
        ) {
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
    return !this.done;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return DisasterSnapshot.write({
      oneShot: this.oneShot,
      done: this.done,
      triggeredBy:
        this.triggeredBy === null ? null : _w.player(this.triggeredBy),
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
    this.oneShot = s.oneShot ?? null;
    this.done = s.done ?? false;
    this.triggeredBy =
      s.triggeredBy === null || s.triggeredBy === undefined
        ? null
        : r.player(s.triggeredBy);
    this.nextAt = s.nextAt;
    this.nextId = s.nextId;
    this.active = s.active === null ? null : { ...s.active };
    this.lastResult = null;
    this.refused = false;
  }
}

const DisasterStateSchema = z.object({
  // Hand-triggered one-shot (optional: older snapshots are schedulers).
  oneShot: z.enum(DISASTER_KINDS).nullable().optional(),
  done: z.boolean().optional(),
  triggeredBy: zPlayerRef().nullable().optional(),
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
