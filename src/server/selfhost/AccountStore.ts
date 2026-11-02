/**
 * AccountStore — the self-hosted player list, in one JSON file.
 *
 * Small by design (tens of players): every read re-checks the file's mtime,
 * so the master (which edits accounts) and the workers (which verify
 * tokens) always agree without a database. Writes are atomic (temp file +
 * rename). Passwords are hashed with scrypt and a per-account salt; the
 * plain password is never stored or logged.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
export const MIN_PASSWORD_LENGTH = 6;

const AccountSchema = z.object({
  username: z.string(),
  persistentId: z.uuid(),
  role: z.enum(["admin", "player"]),
  /** scrypt$N$r$p$salt$hash (base64) */
  passwordHash: z.string(),
  /** Bumped on password reset; tokens carry it, so old sessions end. */
  version: z.number().int().nonnegative(),
  disabled: z.boolean(),
  createdAt: z.number(),
});
export type Account = z.infer<typeof AccountSchema>;
const FileSchema = z.object({ accounts: z.array(AccountSchema) });

/** What the admin UI sees (never the hash). */
export interface PublicAccount {
  username: string;
  role: Account["role"];
  disabled: boolean;
  createdAt: number;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(
    password,
    Buffer.from(saltB64, "base64"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    },
  );
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

export class AccountError extends Error {}

export class AccountStore {
  private accounts: Account[] = [];
  /** mtime:size of the file last loaded (detects edits by other processes). */
  private stamp = "";

  constructor(private readonly file: string) {}

  static inDir(dir: string): AccountStore {
    return new AccountStore(path.join(dir, "accounts.json"));
  }

  list(): PublicAccount[] {
    this.reload();
    return this.accounts.map((a) => ({
      username: a.username,
      role: a.role,
      disabled: a.disabled,
      createdAt: a.createdAt,
    }));
  }

  count(): number {
    this.reload();
    return this.accounts.length;
  }

  find(username: string): Account | undefined {
    this.reload();
    const key = username.toLowerCase();
    return this.accounts.find((a) => a.username.toLowerCase() === key);
  }

  findById(persistentId: string): Account | undefined {
    this.reload();
    return this.accounts.find((a) => a.persistentId === persistentId);
  }

  /** The account if the password matches and it is enabled, else null. */
  authenticate(username: string, password: string): Account | null {
    const a = this.find(username);
    if (!a || a.disabled) {
      // Spend the same time as a real check so usernames can't be probed.
      verifyPassword(password, DUMMY_HASH);
      return null;
    }
    return verifyPassword(password, a.passwordHash) ? a : null;
  }

  create(username: string, password: string, role: Account["role"]): Account {
    if (!USERNAME_RE.test(username)) {
      throw new AccountError(
        "Username must be 3–24 characters: letters, numbers, _ . -",
      );
    }
    checkPassword(password);
    if (this.find(username)) throw new AccountError("Username already exists");
    const account: Account = {
      username,
      persistentId: crypto.randomUUID(),
      role,
      passwordHash: hashPassword(password),
      version: 0,
      disabled: false,
      createdAt: Date.now(),
    };
    this.accounts.push(account);
    this.save();
    return account;
  }

  setPassword(username: string, password: string): void {
    checkPassword(password);
    const a = this.require(username);
    a.passwordHash = hashPassword(password);
    a.version++;
    this.save();
  }

  setDisabled(username: string, disabled: boolean): void {
    const a = this.require(username);
    if (disabled && a.role === "admin" && this.enabledAdmins() <= 1) {
      throw new AccountError("Cannot disable the last admin");
    }
    a.disabled = disabled;
    a.version++;
    this.save();
  }

  setRole(username: string, role: Account["role"]): void {
    const a = this.require(username);
    if (a.role === "admin" && role !== "admin" && this.enabledAdmins() <= 1) {
      throw new AccountError("Cannot demote the last admin");
    }
    a.role = role;
    a.version++;
    this.save();
  }

  remove(username: string): void {
    const a = this.require(username);
    if (a.role === "admin" && this.enabledAdmins() <= 1) {
      throw new AccountError("Cannot remove the last admin");
    }
    this.accounts = this.accounts.filter((x) => x !== a);
    this.save();
  }

  private enabledAdmins(): number {
    return this.accounts.filter((a) => a.role === "admin" && !a.disabled)
      .length;
  }

  private require(username: string): Account {
    const a = this.find(username);
    if (!a) throw new AccountError("No such user");
    return a;
  }

  private reload(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.file);
    } catch {
      this.accounts = [];
      this.stamp = "";
      return;
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (stamp === this.stamp) return;
    const parsed = FileSchema.parse(
      JSON.parse(fs.readFileSync(this.file, "utf8")),
    );
    this.accounts = parsed.accounts;
    this.stamp = stamp;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ accounts: this.accounts }, null, 2),
      {
        mode: 0o600,
      },
    );
    fs.renameSync(tmp, this.file);
    const stat = fs.statSync(this.file);
    this.stamp = `${stat.mtimeMs}:${stat.size}`;
  }
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (password.length > 200) throw new AccountError("Password too long");
}

const DUMMY_HASH = hashPassword("dummy-password-for-timing");
