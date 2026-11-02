import {
  PlayerBuildableUnitType,
  type WeaponId,
} from "@laukolaroser/engine-api/game/GameTypes";

export interface UIState {
  preventStacking?: boolean;
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /** Weapon being aimed (next map click fires it), or null. */
  weaponTargeting?: WeaponId | null;
}
