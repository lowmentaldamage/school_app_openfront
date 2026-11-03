/**
 * Records finished multiplayer games into self-hosted players' stats.
 * Called from the game server when it archives a game (any process: the
 * stats files are per account, see PlayerData).
 */

import type { GameRecord } from "@laukolaroser/shared/WireSchemas";
import { recordGame, winnerClientIds } from "./PlayerData";
import { selfHostEnabled } from "./SelfHost";
import { accountStore } from "./SelfHostAuth";

/** Returns how many accounts were updated. Never throws. */
export function recordSelfHostedGame(record: GameRecord): number {
  if (!selfHostEnabled()) return 0;
  try {
    const winners = winnerClientIds(
      record.info.winner as readonly unknown[] | undefined,
    );
    const solo = record.info.config.gameType === "Singleplayer";
    let n = 0;
    for (const p of record.info.players) {
      if (!p.persistentID) continue;
      if (!accountStore().findById(p.persistentID)) continue;
      recordGame(p.persistentID, {
        solo,
        won: winners.has(p.clientID),
        seconds: record.info.duration,
      });
      n++;
    }
    return n;
  } catch (e) {
    console.error("self-host: could not record game stats", e);
    return 0;
  }
}
