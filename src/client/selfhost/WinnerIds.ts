/**
 * The clientIDs of a game's winners, from the record's winner tuple:
 * ["player", id, ...] or ["team" | "nation", name, ...ids].
 * (Server twin: src/server/selfhost/PlayerData.ts winnerClientIds.)
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
