/**
 * NationTechBehavior — AI nations research the tech tree.
 *
 * On decision ticks, when idle and rich enough (3× the cost), a nation
 * starts the next tech of a branch it favours; the favourite branch comes
 * from its own id, so nations specialise differently. Never on Easy.
 * Stateless, with its own PseudoRandom seeded from the tick and the
 * nation, so it never shifts the nation's main random sequence.
 */

import { Difficulty } from "@laukolaroser/engine-api/game/GameTypes";
import { PseudoRandom } from "@laukolaroser/engine-lib/PseudoRandom";
import {
  researchBlock,
  type TechBranch,
  type TechId,
  TECHS,
} from "@laukolaroser/engine-lib/tech/Tech";
import { Game, Player } from "../../game/Game";
import { ResearchExecution, techTreeEnabled } from "../ResearchExecution";

const BRANCHES: readonly TechBranch[] = ["army", "economy", "navy", "air"];

export class NationTechBehavior {
  constructor(
    private readonly mg: Game,
    private readonly player: Player,
  ) {}

  /** Call on the nation's decision ticks. Returns the tech started, if any. */
  maybeResearch(): TechId | null {
    if (!techTreeEnabled(this.mg)) return null;
    if (this.mg.config().gameConfig().difficulty === Difficulty.Easy) {
      return null;
    }
    if (this.player.research() !== null) return null;
    const rand = new PseudoRandom(
      this.mg.ticks() * 4_909 + this.player.smallID() * 31_337,
    );
    if (!rand.chance(3)) return null;
    // Favourite branch first, then the others in a fixed order.
    const fav = this.player.smallID() % BRANCHES.length;
    for (let k = 0; k < BRANCHES.length; k++) {
      const branch = BRANCHES[(fav + k) % BRANCHES.length];
      for (const t of TECHS) {
        if (t.branch !== branch) continue;
        const block = researchBlock(
          t.id,
          this.player.techMask(),
          null,
          this.player.gold() / 3n,
          true,
        );
        if (block === "researched") continue;
        if (block !== null) break; // next tier locked or too expensive
        this.mg.addExecution(new ResearchExecution(this.player, t.id));
        return t.id;
      }
    }
    return null;
  }
}
