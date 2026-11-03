/**
 * ResearchExecution — a player starts researching a tech (research intent).
 *
 * Checks the rules (engine-lib/tech/Tech.ts researchBlock), pays the gold
 * and records the project on the player, then stays active until the
 * research time is up and completes it.
 */

import { MessageType } from "@laukolaroser/engine-api/game/GameTypes";
import { zPlayerRef } from "@laukolaroser/engine-lib/snapshot/SnapshotType";
import {
  researchBlock,
  type ResearchBlock,
  type TechId,
  TECH_IDS,
  techSpec,
} from "@laukolaroser/engine-lib/tech/Tech";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export function techTreeEnabled(mg: Game): boolean {
  return mg.config().gameConfig().disableTechTree !== true;
}

export class ResearchExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  /** Why the research did not start (null when it did). For tests/UI. */
  rejection: ResearchBlock = null;

  constructor(
    private player: Player,
    private tech: TechId,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    this.mg = mg;
    const research = this.player.research();
    this.rejection = researchBlock(
      this.tech,
      this.player.techMask(),
      research === null ? null : research.tech,
      this.player.gold(),
      techTreeEnabled(mg) && this.player.isAlive(),
    );
    if (this.rejection !== null) return;
    const spec = techSpec(this.tech);
    this.player.removeGold(spec.cost);
    this.player.startResearch(this.tech, ticks + spec.ticks);
    this.active = true;
  }

  tick(ticks: number): void {
    if (this.mg === null) return;
    completeResearchIfDue(this.mg, this.player, ticks);
    if (this.player.research() === null) this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ResearchExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      player: w.player(this.player),
      tech: this.tech,
      rejection: this.rejection,
    });
  }

  restoreSnapshot(s: ResearchState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.player = r.player(s.player);
    this.tech = s.tech;
    this.rejection = s.rejection;
  }
}

/** Finish the player's research if its time is up (PlayerExecution). */
export function completeResearchIfDue(
  mg: Game,
  player: Player,
  ticks: number,
): void {
  const r = player.research();
  if (r === null || ticks < r.endsAt) return;
  const tech = player.finishResearch();
  if (tech === null) return;
  mg.displayMessage(
    `events_display.research_done_${tech}`,
    MessageType.RESEARCH_COMPLETE,
    player.id(),
  );
}

const ResearchStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  tech: z.enum(TECH_IDS),
  rejection: z
    .enum(["researched", "busy", "locked", "gold", "disabled"])
    .nullable(),
});
type ResearchState = z.infer<typeof ResearchStateSchema>;

export const ResearchExecutionSnapshot = execSnapshotType({
  name: "Research",
  version: 1,
  schema: ResearchStateSchema,
  cls: () => ResearchExecution,
});
