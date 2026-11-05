/**
 * AccountStore — the self-hosted player list, in one JSON file.
 *
 * Small by design (tens of players): every read re-checks the file's mtime,
 * so the master (which edits accounts) and the workers (which verify
 * tokens) always agree without a database. Writes are atomic (temp file +
 * rename). Passwords are hashed with scrypt and a per-account salt; the
 * plain password is never stored or logged.
 *
 * Private-group rules (see docs/SelfHosting.md):
 *  - at most SELFHOST_MAX_ACCOUNTS accounts (default 100), pending included;
 *  - players can request access (SELFHOST_REGISTRATION, on by default):
 *    the account waits, disabled, until an admin approves it;
 *  - each account can sign in on at most SELFHOST_MAX_DEVICES devices
 *    (default 2); an admin frees slots;
 *  - after SELFHOST_MAX_FAILED_LOGINS wrong passwords in a row (default
 *    10) the account locks until an admin unlocks it (or resets its
 *    password);
 *  - admins can have a second sign-in step (TwoFactor.ts).
 * Only the master writes this file (logins, admin actions).
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
  /** Waiting for an admin to approve an access request. */
  pending: z.boolean().optional(),
  /** Wrong passwords in a row since the last successful sign-in. */
  failedLogins: z.number().int().nonnegative().optional(),
  /** Locked after too many wrong passwords; only an admin unlocks. */
  locked: z.boolean().optional(),
  /** Admin two-step sign-in: authenticator secret (base32) once set up. */
  totpSecret: z.string().optional(),
  /** A secret shown for setup, active after its first correct code. */
  totpPending: z.string().optional(),
  /** Devices this account has signed in on (oldest first). */
  devices: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        firstSeen: z.number(),
        lastSeen: z.number(),
      }),
    )
    .optional(),
});
export type Account = z.infer<typeof AccountSchema>;
const FileSchema = z.object({ accounts: z.array(AccountSchema) });

/** What the admin UI sees (never the hash). */
export interface PublicAccount {
  username: string;
  role: Account["role"];
  disabled: boolean;
  createdAt: number;
  pending: boolean;
  locked: boolean;
  failedLogins: number;
  /** An authenticator app is set up (admins). */
  twoFactor: boolean;
  devices: { id: string; name: string; lastSeen: number }[];
}

/** Wrong passwords in a row that lock an account (default 10). */
export function maxFailedLogins(): number {
  const n = Number(process.env.SELFHOST_MAX_FAILED_LOGINS ?? 10);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

export type LoginResult =
  | { ok: true; account: Account }
  | { ok: false; reason: "wrong"; attemptsLeft: number | null }
  | { ok: false; reason: "locked" };

export const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Max accounts on this server (SELFHOST_MAX_ACCOUNTS, default 100). */
export function maxAccounts(): number {
  const n = Number(process.env.SELFHOST_MAX_ACCOUNTS ?? 100);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

/** Max devices per account (SELFHOST_MAX_DEVICES, default 2). */
export function maxDevices(): number {
  const n = Number(process.env.SELFHOST_MAX_DEVICES ?? 2);
  return Number.isInteger(n) && n > 0 ? n : 2;
}

/** Whether players may request access (SELFHOST_REGISTRATION, default on). */
export function registrationOpen(): boolean {
  const v = (process.env.SELFHOST_REGISTRATION ?? "on").toLowerCase();
  return !["0", "off", "false", "no"].includes(v);
}

/** Why a device may not sign in, or null if it may. */
export type DeviceRefusal = "too_many_devices" | null;

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
      pending: a.pending === true,
      locked: a.locked === true,
      failedLogins: a.failedLogins ?? 0,
      twoFactor: a.totpSecret !== undefined,
      devices: (a.devices ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        lastSeen: d.lastSeen,
      })),
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

  /**
   * A sign-in attempt with lockout: wrong passwords count per account;
   * at maxFailedLogins() the account locks until an admin unlocks it.
   * `attemptsLeft` is only given for an existing account, when few remain.
   */
  login(username: string, password: string): LoginResult {
    const a = this.find(username);
    if (!a) {
      verifyPassword(password, DUMMY_HASH);
      return { ok: false, reason: "wrong", attemptsLeft: null };
    }
    const good = verifyPassword(password, a.passwordHash);
    if (a.locked) return { ok: false, reason: "locked" };
    if (good) {
      if ((a.failedLogins ?? 0) > 0) {
        a.failedLogins = 0;
        this.save();
      }
      return { ok: true, account: a };
    }
    a.failedLogins = (a.failedLogins ?? 0) + 1;
    if (a.failedLogins >= maxFailedLogins()) {
      a.locked = true;
      this.save();
      return { ok: false, reason: "locked" };
    }
    this.save();
    const left = maxFailedLogins() - a.failedLogins;
    return {
      ok: false,
      reason: "wrong",
      attemptsLeft: left <= 3 ? left : null,
    };
  }

  /**
   * A wrong second-step code: counts toward the lockout like a wrong
   * password. Returns true when the account is now locked.
   */
  failSecondStep(username: string): boolean {
    const a = this.require(username);
    a.failedLogins = (a.failedLogins ?? 0) + 1;
    if (a.failedLogins >= maxFailedLogins()) a.locked = true;
    this.save();
    return a.locked === true;
  }

  /** Clears the failure count after a passed second step. */
  passSecondStep(username: string): void {
    const a = this.require(username);
    if ((a.failedLogins ?? 0) > 0) {
      a.failedLogins = 0;
      this.save();
    }
  }

  /** The authenticator secret to show for setup (kept until confirmed). */
  pendingTotp(username: string, fresh: () => string): string {
    const a = this.require(username);
    if (a.totpPending === undefined) {
      a.totpPending = fresh();
      this.save();
    }
    return a.totpPending;
  }

  /** The setup code was right: the pending secret becomes active. */
  confirmTotp(username: string): void {
    const a = this.require(username);
    if (a.totpPending === undefined) return;
    a.totpSecret = a.totpPending;
    a.totpPending = undefined;
    this.save();
  }

  /** Removes an admin's authenticator (lost phone); set up again at sign-in. */
  resetTotp(username: string): void {
    const a = this.require(username);
    a.totpSecret = undefined;
    a.totpPending = undefined;
    a.version++;
    this.save();
  }

  unlock(username: string): void {
    const a = this.require(username);
    a.locked = false;
    a.failedLogins = 0;
    this.save();
  }

  /** A player's access request: a disabled account an admin must approve. */
  request(username: string, password: string): Account {
    const a = this.create(username, password, "player");
    a.pending = true;
    a.disabled = true;
    this.save();
    return a;
  }

  approve(username: string): void {
    const a = this.require(username);
    a.pending = false;
    a.disabled = false;
    a.version++;
    this.save();
  }

  /**
   * Register a sign-in from `deviceId`. Known devices just refresh;
   * a new one takes a free slot or is refused.
   */
  useDevice(
    username: string,
    deviceId: string,
    deviceName: string,
    now = Date.now(),
  ): DeviceRefusal {
    const a = this.require(username);
    const list = (a.devices ??= []);
    const known = list.find((d) => d.id === deviceId);
    if (known) {
      // Avoid rewriting the file on every page load.
      if (now - known.lastSeen > 60 * 60 * 1000) {
        known.lastSeen = now;
        this.save();
      }
      return null;
    }
    if (list.length >= maxDevices()) return "too_many_devices";
    list.push({
      id: deviceId,
      name: deviceName.slice(0, 60),
      firstSeen: now,
      lastSeen: now,
    });
    this.save();
    return null;
  }

  hasDevice(account: Account, deviceId: string): boolean {
    return (account.devices ?? []).some((d) => d.id === deviceId);
  }

  /** Free one device slot (or all with `deviceId` null); signs it out. */
  removeDevice(username: string, deviceId: string | null): void {
    const a = this.require(username);
    a.devices =
      deviceId === null
        ? []
        : (a.devices ?? []).filter((d) => d.id !== deviceId);
    this.save();
  }

  create(username: string, password: string, role: Account["role"]): Account {
    if (this.count() >= maxAccounts()) {
      throw new AccountError(
        `This server is full (${maxAccounts()} accounts). Ask the admin.`,
      );
    }
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
    // A new password from the admin also unlocks the account.
    a.locked = false;
    a.failedLogins = 0;
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
