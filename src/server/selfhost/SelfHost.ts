/**
 * Self-hosted mode — run Laukolaroser on your own server with private
 * accounts and no external services.
 *
 * Enabled with SELF_HOSTED=1. Then:
 *   - only players with an account (created by an admin) can join games,
 *   - accounts live in <data dir>/accounts.json (scrypt-hashed passwords),
 *   - the server signs its own session tokens with a secret kept in
 *     <data dir>/session-secret (created on first start, 0600),
 *   - the first admin comes from SELFHOST_ADMIN_USER / SELFHOST_ADMIN_PASSWORD
 *     (only used while no accounts exist) or `npm run selfhost:admin`.
 *
 * The master and worker processes share the data directory, so a token
 * issued by the master is accepted by every worker.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

export function selfHostEnabled(): boolean {
  return process.env.SELF_HOSTED === "1" || process.env.SELF_HOSTED === "true";
}

export function selfHostDataDir(): string {
  return path.resolve(process.env.SELFHOST_DATA_DIR ?? "data");
}

let cachedSecret: Buffer | null = null;

/** The HMAC key for session tokens; created on first use. */
export function sessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const dir = selfHostDataDir();
  const file = path.join(dir, "session-secret");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    // wx: if another process created it in between, keep theirs.
    try {
      fs.writeFileSync(file, crypto.randomBytes(48).toString("base64"), {
        mode: 0o600,
        flag: "wx",
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  cachedSecret = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  if (cachedSecret.length < 32) {
    throw new Error(`self-host: ${file} is too short; delete it to regenerate`);
  }
  return cachedSecret;
}
