/**
 * Two-step sign-in for admins: after the right password, a 6-digit code
 * from an authenticator app (TOTP, RFC 6238: Google Authenticator, Authy,
 * Microsoft Authenticator...) or, as a backup, a one-time code the
 * server's Telegram bot sends to the admin chats.
 *
 * SELFHOST_ADMIN_2FA:
 *   "required" every admin must pass the second step (first sign-in sets
 *              up the authenticator app);
 *   "optional" (default) only admins who set up an authenticator.
 *
 * Between the two steps the client holds a short-lived signed ticket
 * (5 min), so the password is not sent twice and no device slot is used
 * until the second step passes. Wrong codes count toward the account
 * lockout like wrong passwords. Node crypto only; no extra dependencies.
 */

import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new authenticator secret (160 bits, base32). */
export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The 6-digit code for a 30-second step (RFC 6238, SHA-1). */
export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = crypto
    .createHmac("sha1", base32Decode(secret))
    .update(msg)
    .digest();
  const off = mac[mac.length - 1] & 15;
  const bin =
    ((mac[off] & 0x7f) << 24) |
    (mac[off + 1] << 16) |
    (mac[off + 2] << 8) |
    mac[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** True when `code` matches now, one step before or one after. */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(nowMs / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    const want = Buffer.from(totpCode(secret, s));
    if (crypto.timingSafeEqual(want, Buffer.from(c))) return true;
  }
  return false;
}

/** The link authenticator apps open (otpauth://totp/...). */
export function otpauthUri(secret: string, account: string): string {
  const label = encodeURIComponent(`Laukolaroser:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Laukolaroser&digits=6&period=30`;
}

export function adminTwoFactorRequired(env = process.env): boolean {
  return (env.SELFHOST_ADMIN_2FA ?? "optional").toLowerCase() === "required";
}

// ---------------------------------------------------------------- tickets

export interface TicketData {
  /** Username. */
  u: string;
  /** Account version (a password reset voids pending tickets). */
  v: number;
  /** Device id and name for the session that follows. */
  d: string;
  n: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

const TICKET_MS = 5 * 60 * 1000;

export function issueTicket(
  data: Omit<TicketData, "exp">,
  secret: string | Buffer,
  nowMs = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...data, exp: nowMs + TICKET_MS }),
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`2fa.${body}`)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function readTicket(
  ticket: string,
  secret: string | Buffer,
  nowMs = Date.now(),
): TicketData | null {
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return null;
  const want = crypto
    .createHmac("sha256", secret)
    .update(`2fa.${body}`)
    .digest("base64url");
  if (
    want.length !== sig.length ||
    !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))
  ) {
    return null;
  }
  try {
    const data = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as TicketData;
    if (typeof data.exp !== "number" || data.exp < nowMs) return null;
    return data;
  } catch {
    return null;
  }
}

// --------------------------------------------------------- Telegram codes

const TELEGRAM_CODE_MS = 5 * 60 * 1000;

/** One-time codes sent by Telegram, by lower-cased username (memory only). */
export class TelegramCodes {
  private readonly codes = new Map<string, { code: string; exp: number }>();

  issue(username: string, nowMs = Date.now()): string {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    this.codes.set(username.toLowerCase(), {
      code,
      exp: nowMs + TELEGRAM_CODE_MS,
    });
    return code;
  }

  /** Checks and consumes the code. */
  check(username: string, code: string, nowMs = Date.now()): boolean {
    const key = username.toLowerCase();
    const entry = this.codes.get(key);
    if (!entry || entry.exp < nowMs) {
      this.codes.delete(key);
      return false;
    }
    const c = code.replace(/\s/g, "");
    const ok =
      c.length === entry.code.length &&
      crypto.timingSafeEqual(Buffer.from(c), Buffer.from(entry.code));
    if (ok) this.codes.delete(key);
    return ok;
  }
}
