/**
 * Per-account data on a self-hosted server: game stats and the player's
 * synced settings. One small JSON file per account and kind under the data
 * directory (stats/<id>.json, settings/<id>.json), so the game servers
 * (which record results) and the master (logins, admin) never overwrite
 * each other's files. Writes are atomic (temp file + rename).
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import { selfHostDataDir } from "./SelfHost";

export const StatsSchema = z.object({
  /** Multiplayer games finished. */
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  soloGames: z.number().int().nonnegative(),
  soloWins: z.number().int().nonnegative(),
  /** Total time in finished games, seconds. */
  playSeconds: z.number().nonnegative(),
  lastPlayed: z.number(),
});
export type PlayerStats = z.infer<typeof StatsSchema>;

export const EMPTY_STATS: PlayerStats = {
  games: 0,
  wins: 0,
  soloGames: 0,
  soloWins: 0,
  playSeconds: 0,
  lastPlayed: 0,
};

/** Synced settings are a flat string map, capped in size. */
export const SETTINGS_MAX_BYTES = 64 * 1024;
export const SettingsSchema = z.record(
  z.string().max(200),
  z.string().max(20_000),
);

const ID_RE = /^[0-9a-f-]{36}$/i;

function fileFor(kind: "stats" | "settings", persistentId: string): string {
  if (!ID_RE.test(persistentId)) throw new Error("bad account id");
  return path.join(selfHostDataDir(), kind, `${persistentId}.json`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readStats(persistentId: string): PlayerStats {
  const parsed = StatsSchema.safeParse(
    readJson(fileFor("stats", persistentId)),
  );
  return parsed.success ? parsed.data : { ...EMPTY_STATS };
}

export function recordGame(
  persistentId: string,
  result: { solo: boolean; won: boolean; seconds: number },
  now = Date.now(),
): PlayerStats {
  const s = readStats(persistentId);
  if (result.solo) {
    s.soloGames++;
    if (result.won) s.soloWins++;
  } else {
    s.games++;
    if (result.won) s.wins++;
  }
  // A game cannot sensibly last more than a day.
  s.playSeconds += Math.max(0, Math.min(86_400, result.seconds));
  s.lastPlayed = now;
  writeJson(fileFor("stats", persistentId), s);
  return s;
}

export function readSettings(persistentId: string): Record<string, string> {
  const parsed = SettingsSchema.safeParse(
    readJson(fileFor("settings", persistentId)),
  );
  return parsed.success ? parsed.data : {};
}

export function writeSettings(
  persistentId: string,
  settings: Record<string, string>,
): void {
  const json = JSON.stringify(settings);
  if (json.length > SETTINGS_MAX_BYTES) throw new Error("settings too large");
  writeJson(fileFor("settings", persistentId), settings);
}

/** Remove an account's files (account deleted). */
export function forgetAccount(persistentId: string): void {
  for (const kind of ["stats", "settings"] as const) {
    try {
      fs.unlinkSync(fileFor(kind, persistentId));
    } catch {
      // never had any
    }
  }
}

/**
 * Who won, from a game record's winner tuple: ["player", id, ...] or
 * ["team"|"nation", name, ...ids]. Ids are clientIDs.
 */
export function winnerClientIds(
  winner: readonly unknown[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!winner || winner.length < 2) return ids;
  const start = winner[0] === "player" ? 1 : 2;
  for (let i = start; i < winner.length; i++) {
    if (typeof winner[i] === "string") ids.add(winner[i] as string);
  }
  return ids;
}
