import { UnitType } from "@laukolaroser/engine-api/game/GameTypes";
import {
  ECONOMY_BUILDINGS,
  type EconomyBuildingType,
  INCOME_INTERVAL_TICKS,
  incomePerInterval,
  OIL_RIG_RANGE,
} from "@laukolaroser/engine-lib/economy/Economy";
import { zInt, zRef } from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import {
  TECH_EFFECTS,
  techPercentBig,
} from "@laukolaroser/engine-lib/tech/Tech";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** How often an oil rig checks that its owner still holds nearby coast. */
const RIG_CHECK_TICKS = 50;

/**
 * Gold Mine, Market, Oil Rig: pays its owner every INCOME_INTERVAL_TICKS
 * (engine-lib/economy/Economy.ts). Land buildings change hands with the
 * land (like every structure); an oil rig is lost when its owner no longer
 * holds land within OIL_RIG_RANGE.
 */
export class IncomeBuildingExecution implements Execution {
  private mg: Game | null = null;
  private active = true;
  private nextPay = 0;

  constructor(private building: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.nextPay = ticks + INCOME_INTERVAL_TICKS;
  }

  tick(ticks: number): void {
    const b = this.building;
    if (!b.isActive()) {
      this.active = false;
      return;
    }
    if (b.isUnderConstruction()) return;
    if (
      b.type() === UnitType.OilRig &&
      ticks % RIG_CHECK_TICKS === 0 &&
      !b.owner().ownsLandNear(b.tile(), OIL_RIG_RANGE)
    ) {
      b.delete(false);
      this.active = false;
      return;
    }
    if (ticks < this.nextPay) return;
    this.nextPay = ticks + INCOME_INTERVAL_TICKS;
    const spec = ECONOMY_BUILDINGS[b.type() as EconomyBuildingType];
    if (spec === undefined) return;
    let pay = incomePerInterval(spec, b.level());
    // Tech: Industrialization.
    if (b.owner().hasTech("industry")) {
      pay = techPercentBig(pay, TECH_EFFECTS.industryIncomePercent);
    }
    b.owner().addGold(pay);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return IncomeBuildingSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      building: w.unit(this.building),
      nextPay: this.nextPay,
    });
  }

  restoreSnapshot(s: IncomeBuildingState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.building = r.unit(s.building);
    this.nextPay = s.nextPay;
  }
}

const IncomeBuildingStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  building: zRef(),
  nextPay: zInt(),
});
type IncomeBuildingState = z.infer<typeof IncomeBuildingStateSchema>;

export const IncomeBuildingSnapshot = execSnapshotType({
  name: "IncomeBuilding",
  version: 1,
  schema: IncomeBuildingStateSchema,
  cls: () => IncomeBuildingExecution,
});
