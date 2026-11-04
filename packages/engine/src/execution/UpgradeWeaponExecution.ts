/**
 * UpgradeWeaponExecution — a player buys the next power tier of a weapon
 * (upgrade_weapon intent). Checks the rules (engine-lib/weapons/Weapons.ts
 * weaponUpgradeBlock), pays the gold and raises the tier at once.
 * Shots already in flight keep the tier they were fired with.
 */

import { MessageType } from "@laukolaroser/engine-api/game/GameTypes";
import { zPlayerRef } from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import {
  WEAPON_IDS,
  weaponTier,
  weaponUpgradeBlock,
  weaponUpgradeCost,
  withWeaponTier,
  type WeaponId,
  type WeaponTier,
  type WeaponUpgradeBlock,
} from "@laukolaroser/engine-lib/weapons/Weapons";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** Spelled out so the translation-key checker can see them. */
const UPGRADED_KEYS: Record<WeaponId, string> = {
  artillery: "events_display.weapon_upgraded_artillery",
  naval: "events_display.weapon_upgraded_naval",
  airstrike: "events_display.weapon_upgraded_airstrike",
  rocket: "events_display.weapon_upgraded_rocket",
};

export class UpgradeWeaponExecution implements Execution {
  private active = true;
  /** Why the upgrade did not happen (null when it did). For tests/UI. */
  rejection: WeaponUpgradeBlock = null;

  constructor(
    private player: Player,
    private weapon: WeaponId,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.active = false;
    const packed = this.player.weaponTiers();
    // Same pricing as strikes: free with infinite gold.
    const price = (c: bigint) => mg.config().strikeCost(c, this.player);
    this.rejection = weaponUpgradeBlock(
      packed,
      this.weapon,
      this.player.gold(),
      this.player.isAlive(),
      price,
    );
    if (this.rejection !== null) return;
    const cost = price(weaponUpgradeCost(packed, this.weapon)!);
    const next = (weaponTier(packed, this.weapon) + 1) as WeaponTier;
    if (cost > 0n) this.player.removeGold(cost);
    this.player.setWeaponTiers(withWeaponTier(packed, this.weapon, next));
    mg.displayMessage(
      UPGRADED_KEYS[this.weapon],
      MessageType.RESEARCH_COMPLETE,
      this.player.id(),
      undefined,
      { tier: next === 2 ? "II" : "III" },
    );
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return UpgradeWeaponSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      weapon: this.weapon,
      rejection: this.rejection,
    });
  }

  restoreSnapshot(s: UpgradeWeaponState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.weapon = s.weapon;
    this.rejection = s.rejection;
  }
}

const UpgradeWeaponStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  weapon: z.enum(WEAPON_IDS),
  rejection: z.enum(["max", "gold", "dead"]).nullable(),
});
type UpgradeWeaponState = z.infer<typeof UpgradeWeaponStateSchema>;

export const UpgradeWeaponSnapshot = execSnapshotType({
  name: "UpgradeWeapon",
  version: 1,
  schema: UpgradeWeaponStateSchema,
  cls: () => UpgradeWeaponExecution,
});
