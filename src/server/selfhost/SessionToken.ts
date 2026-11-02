/**
 * Session tokens for self-hosted mode.
 *
 * A standard HS256 JWT signed with the server's own secret (so it passes
 * the join schema's JWT check unchanged). The payload carries the account's persistent id (a UUID, used by the game
 * as the player's identity), username, role and expiry. Tokens are checked
 * with a constant-time comparison; a token also stops working as soon as
 * its account is removed or disabled (checked against the account store).
 */

import crypto from "crypto";
import { z } from "zod";

/** base64url({"alg":"HS256","typ":"JWT"}) */
const HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT" }),
).toString("base64url");
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const SessionPayloadSchema = z.object({
  /** Account persistent id (UUID). */
  sub: z.uuid(),
  /** Username at issue time. */
  u: z.string(),
  r: z.enum(["admin", "player"]),
  /** Account version: bumped on password change, invalidating old tokens. */
  v: z.number().int().nonnegative(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

function sign(data: string, secret: Buffer): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueSessionToken(
  payload: Omit<SessionPayload, "iat" | "exp">,
  secret: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const full: SessionPayload = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const signingInput = `${HEADER}.${body}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/** The verified payload, or null for a forged/expired/malformed token. */
export function verifySessionToken(
  token: string,
  secret: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const [header, body, sig] = parts;
  const expected = sign(`${header}.${body}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = SessionPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.exp <= nowSeconds) return null;
  return parsed.data;
}
