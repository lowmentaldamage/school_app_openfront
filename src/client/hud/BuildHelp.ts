/**
 * BuildHelp — "how to use it" and exact numbers for every item on the
 * Build / Forces bar, shown when hovering an item (toggle: the "?" button
 * on the bar, setting `settings.buildBarHelp`).
 *
 * Numbers come from the shared rules (engine-lib), so they always match the
 * simulation. Income is per minute of game time at ×1 speed.
 */

import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import { AIRBASE, BOMBER, FIGHTER } from "@laukolaroser/engine-lib/air/Air";
import { RADAR, radarRange } from "@laukolaroser/engine-lib/defense/Radar";
import {
  ECONOMY_BUILDINGS,
  INCOME_INTERVAL_TICKS,
  MOUNTAIN_MINE_BONUS_PERCENT,
} from "@laukolaroser/engine-lib/economy/Economy";
import { renderNumber } from "@laukolaroser/engine-lib/Format";
import {
  NAVAL_CLASSES,
  SUBMARINE_DETECT_RANGE,
} from "@laukolaroser/engine-lib/naval/NavalClasses";
import { WEAPONS } from "@laukolaroser/engine-lib/weapons/Weapons";
import { translateText } from "../Utils";

export interface HelpLine {
  label: string;
  value: string;
}

export interface BuildHelpInfo {
  /** One short "how to use" sentence. */
  use: string;
  /** Exact numbers. */
  stats: HelpLine[];
}

/** The rule numbers the help needs (the client's Config implements them). */
export interface HelpRules {
  cityTroopIncrease(): number;
  defensePostRange(): number;
  samRange(level: number): number;
  nukeMagnitudes(type: UnitType): { inner: number; outer: number };
  trainStationMaxRange(): number;
}

/** Closest a station may be to its factory (EngineConfig). */
const TRAIN_STATION_MIN_RANGE = 15;

const TICKS_PER_MINUTE = 600;

function perMinute(perTick: number): string {
  return renderNumber(BigInt(Math.round(perTick * TICKS_PER_MINUTE)));
}

function t(key: string, params?: Record<string, string | number>): string {
  return translateText(`build_help.${key}`, params);
}

function line(label: string, value: string | number): HelpLine {
  return { label: t(label), value: String(value) };
}

/** Help for one bar item, or null for items without extra help. */
export function buildHelp(
  type: UnitType,
  rules: HelpRules,
): BuildHelpInfo | null {
  switch (type) {
    case UnitType.City:
      return {
        use: t("use_city"),
        stats: [
          line(
            "max_troops",
            `+${renderNumber(rules.cityTroopIncrease())} / ${t("level")}`,
          ),
          line("upgrade", t("upgrade_click")),
        ],
      };
    case UnitType.Port:
      return {
        use: t("use_port"),
        stats: [
          line("trade_trip", "≈ 50K – 125K+"),
          line("builds", t("ships_list")),
        ],
      };
    case UnitType.Factory:
      return {
        use: t("use_factory"),
        stats: [
          line(
            "rail_range",
            `${TRAIN_STATION_MIN_RANGE}–${rules.trainStationMaxRange()} ${t("tiles")}`,
          ),
          line("train_stop", "10K / 25K / 35K"),
          line("express", "+60%"),
        ],
      };
    case UnitType.DefensePost:
      return {
        use: t("use_defense"),
        stats: [
          line("range", `${rules.defensePostRange()} ${t("tiles")}`),
          line("attacker_losses", "×5"),
          line("attacker_speed", "÷3"),
          line("artillery", t("artillery_ready")),
        ],
      };
    case UnitType.SAMLauncher:
      return {
        use: t("use_sam"),
        stats: [
          line(
            "range",
            `${Math.round(rules.samRange(1))} → ${Math.round(rules.samRange(5))} ${t("tiles")} (L1 → L5)`,
          ),
          line("also_hits", t("bombers")),
        ],
      };
    case UnitType.MissileSilo:
      return {
        use: t("use_silo"),
        stats: [
          line("launches", t("silo_launches")),
          line("rocket_cost", renderNumber(WEAPONS.rocket.cost)),
        ],
      };
    case UnitType.GoldMine:
    case UnitType.Market:
    case UnitType.OilRig: {
      const spec = ECONOMY_BUILDINGS[type];
      const stats = [
        line(
          "income",
          `${perMinute(spec.perTick)} / ${t("minute")} (${t("per_level")})`,
        ),
        line("paid_every", `${INCOME_INTERVAL_TICKS / 10} s`),
      ];
      if (type === UnitType.GoldMine) {
        stats.push(
          line(
            "on_mountain",
            `${perMinute((spec.perTick * MOUNTAIN_MINE_BONUS_PERCENT) / 100)} / ${t("minute")}`,
          ),
        );
      }
      return {
        use: t(
          type === UnitType.GoldMine
            ? "use_mine"
            : type === UnitType.Market
              ? "use_market"
              : "use_rig",
        ),
        stats,
      };
    }
    case UnitType.Airbase:
      return {
        use: t("use_airbase"),
        stats: [
          line("raid_range", `${WEAPONS.airstrike.range} ${t("tiles")}`),
          line("raid_cost", renderNumber(WEAPONS.airstrike.cost)),
          line("bombs", WEAPONS.airstrike.shots),
          line("fighters", `${FIGHTER.interceptRange} ${t("tiles")}`),
          line("cost_from", renderNumber(AIRBASE.baseCost)),
        ],
      };
    case UnitType.RadarStation:
      return {
        use: t("use_radar"),
        stats: [
          line(
            "range",
            `${radarRange(1)} ${t("tiles")} (+${RADAR.rangePerLevel} / ${t("level")})`,
          ),
        ],
      };
    case UnitType.Warship:
    case UnitType.Destroyer:
    case UnitType.Battleship:
    case UnitType.Submarine:
    case UnitType.Carrier: {
      const c = NAVAL_CLASSES[type];
      const stats = [
        line("health", c.maxHealth),
        line("speed", `${Math.round((c.stepsPer6Ticks / 6) * 100)}%`),
        line("damage", `${c.damagePercent}%`),
        line("gun_range", `${c.rangePercent}%`),
      ];
      if (type === UnitType.Submarine) {
        stats.push(line("hidden", `> ${SUBMARINE_DETECT_RANGE} ${t("tiles")}`));
      }
      if (type === UnitType.Carrier) {
        stats.push(line("bomber_hp", BOMBER.maxHealth));
      }
      return { use: t("use_ship"), stats };
    }
    case UnitType.AtomBomb:
    case UnitType.HydrogenBomb: {
      const m = rules.nukeMagnitudes(type);
      return {
        use: t("use_nuke"),
        stats: [
          line("blast", `${m.inner} / ${m.outer} ${t("tiles")}`),
          line("salvo", t("salvo_hint")),
        ],
      };
    }
    case UnitType.MIRV:
      return {
        use: t("use_mirv"),
        stats: [line("salvo", t("salvo_hint"))],
      };
    case UnitType.ArmoredTrain:
    case UnitType.TroopTrain:
    case UnitType.RailSAM:
      return { use: t("use_train"), stats: [] };
    default:
      return null;
  }
}

/** Tips shown under every item. */
export function stackingTip(type: UnitType): string {
  return type === UnitType.AtomBomb ||
    type === UnitType.HydrogenBomb ||
    type === UnitType.MIRV
    ? t("tip_nuke")
    : t("tip_shift");
}
