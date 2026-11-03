/**
 * HTTP API for self-hosted accounts, mounted on the master at /api/selfhost.
 *
 *   GET    /status                      → { enabled, registration, limits }
 *   POST   /login        {username,password,deviceId,deviceName}
 *                                       → { token, username, role }
 *   POST   /register     {username,password} → access request (pending)
 *   GET    /me           (Bearer)       → { username, role, stats }
 *   POST   /password     (Bearer) {current, password}  → change own password
 *   POST   /stats/solo   (Bearer) {won, seconds}       → record a solo game
 *   GET    /settings     (Bearer)       → synced settings
 *   PUT    /settings     (Bearer) {settings}           → save settings
 *   Admin only (Bearer, role admin):
 *   GET    /users                       → PublicAccount[]
 *   POST   /users        {username, password, role?}   → create
 *   POST   /users/:name/password {password}            → reset password
 *   POST   /users/:name/disabled {disabled}            → enable/disable
 *   POST   /users/:name/role     {role}                → admin/player
 *   DELETE /users/:name                                → remove
 *   POST   /users/:name/approve                        → approve a request
 *   DELETE /users/:name/devices[/:id]                  → free device slot(s)
 *
 * Login attempts are rate limited per IP. Every change takes effect at
 * once: tokens are re-checked against the account list on every join.
 */

import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  AccountError,
  DEVICE_ID_RE,
  maxAccounts,
  maxDevices,
  registrationOpen,
  type Account,
} from "./AccountStore";
import {
  forgetAccount,
  readSettings,
  readStats,
  recordGame,
  SettingsSchema,
  writeSettings,
} from "./PlayerData";
import { sessionSecret } from "./SelfHost";
import {
  accountFromAuthHeader,
  accountStore,
  sessionFromAuthHeader,
} from "./SelfHostAuth";
import { issueSessionToken } from "./SessionToken";

const LoginSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(200),
  deviceId: z.string().regex(DEVICE_ID_RE),
  deviceName: z.string().max(120).default("Device"),
});
const RegisterSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(200),
});
const SoloSchema = z.object({
  won: z.boolean(),
  seconds: z.number().nonnegative().max(86_400),
});
const CreateSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(200),
  role: z.enum(["admin", "player"]).default("player"),
});
const PasswordSchema = z.object({ password: z.string().max(200) });
const OwnPasswordSchema = z.object({
  current: z.string().max(200),
  password: z.string().max(200),
});

/** Sliding-window limiter on FAILED logins: 10 / 10 min / IP. */
class LoginLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 10 * 60 * 1000,
  ) {}
  blocked(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    this.hits.set(key, list);
    return list.length >= this.max;
  }
  recordFailure(key: string, now = Date.now()): void {
    const list = this.hits.get(key) ?? [];
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.hits.clear();
  }
}

function tokenFor(account: Account, deviceId: string): string {
  return issueSessionToken(
    {
      sub: account.persistentId,
      u: account.username,
      r: account.role,
      v: account.version,
      d: deviceId,
    },
    sessionSecret(),
  );
}

export function createSelfHostRouter(): express.Router {
  const router = express.Router();
  const limiter = new LoginLimiter();
  // Access requests have their own budget (20 / hour / IP), so a busy
  // shared network can't lock its players out of signing in.
  const requestLimiter = new LoginLimiter(20, 60 * 60 * 1000);
  const store = accountStore();

  const fail = (res: Response, status: number, error: string) =>
    res.status(status).json({ error });

  const handle =
    (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response) => {
      try {
        fn(req, res);
      } catch (e) {
        if (e instanceof AccountError) {
          fail(res, 400, e.message);
          return;
        }
        console.error("self-host route error", e);
        fail(res, 500, "Server error");
      }
    };

  const requireAdmin = (req: Request, res: Response): Account | null => {
    const me = accountFromAuthHeader(req.headers.authorization);
    if (me === null) {
      fail(res, 401, "Please log in");
      return null;
    }
    if (me.role !== "admin") {
      fail(res, 403, "Admins only");
      return null;
    }
    return me;
  };

  router.get("/status", (_req, res) => {
    res.json({
      enabled: true,
      ownServer: true,
      registration: registrationOpen(),
      maxDevices: maxDevices(),
    });
  });

  router.post(
    "/register",
    handle((req, res) => {
      if (!registrationOpen()) {
        fail(res, 403, "Ask the admin for an account");
        return;
      }
      const ip = req.ip ?? "unknown";
      if (requestLimiter.blocked(ip)) {
        fail(res, 429, "Too many requests, try again later");
        return;
      }
      requestLimiter.recordFailure(ip);
      const body = RegisterSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "Username and password required");
        return;
      }
      store.request(body.data.username, body.data.password);
      res.status(201).json({ pending: true });
    }),
  );

  router.post(
    "/login",
    handle((req, res) => {
      const ip = req.ip ?? "unknown";
      if (limiter.blocked(ip)) {
        fail(res, 429, "Too many attempts, try again in a few minutes");
        return;
      }
      const body = LoginSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "Username and password required");
        return;
      }
      const account = store.checkPassword(
        body.data.username,
        body.data.password,
      );
      if (account === null) {
        limiter.recordFailure(ip);
        fail(res, 401, "Wrong username or password");
        return;
      }
      if (account.pending) {
        fail(res, 403, "Your access request is waiting for the admin");
        return;
      }
      if (account.disabled) {
        fail(res, 403, "This account is disabled");
        return;
      }
      const refused = store.useDevice(
        account.username,
        body.data.deviceId,
        body.data.deviceName,
      );
      if (refused !== null) {
        fail(
          res,
          403,
          `This account is already used on ${maxDevices()} devices. Ask the admin to free one.`,
        );
        return;
      }
      res.json({
        token: tokenFor(account, body.data.deviceId),
        username: account.username,
        role: account.role,
      });
    }),
  );

  router.get(
    "/me",
    handle((req, res) => {
      const session = sessionFromAuthHeader(req.headers.authorization);
      if (session === null) {
        fail(res, 401, "Please log in");
        return;
      }
      const me = session.account;
      // Keeps the device's "last seen" fresh for the admin list.
      store.useDevice(me.username, session.deviceId, "");
      res.json({
        username: me.username,
        role: me.role,
        stats: readStats(me.persistentId),
      });
    }),
  );

  router.post(
    "/password",
    handle((req, res) => {
      const me = accountFromAuthHeader(req.headers.authorization);
      if (me === null) {
        fail(res, 401, "Please log in");
        return;
      }
      const body = OwnPasswordSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "Current and new password required");
        return;
      }
      if (store.authenticate(me.username, body.data.current) === null) {
        fail(res, 403, "Current password is wrong");
        return;
      }
      store.setPassword(me.username, body.data.password);
      // The old token is now invalid; hand back a fresh one.
      const session = sessionFromAuthHeader(req.headers.authorization);
      res.json({
        token: tokenFor(store.find(me.username)!, session?.deviceId ?? ""),
      });
    }),
  );

  router.post(
    "/stats/solo",
    handle((req, res) => {
      const me = accountFromAuthHeader(req.headers.authorization);
      if (me === null) {
        fail(res, 401, "Please log in");
        return;
      }
      const body = SoloSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "won and seconds required");
        return;
      }
      res.json({
        stats: recordGame(me.persistentId, { solo: true, ...body.data }),
      });
    }),
  );

  router.get(
    "/settings",
    handle((req, res) => {
      const me = accountFromAuthHeader(req.headers.authorization);
      if (me === null) {
        fail(res, 401, "Please log in");
        return;
      }
      res.json({ settings: readSettings(me.persistentId) });
    }),
  );

  router.put(
    "/settings",
    handle((req, res) => {
      const me = accountFromAuthHeader(req.headers.authorization);
      if (me === null) {
        fail(res, 401, "Please log in");
        return;
      }
      const body = z.object({ settings: SettingsSchema }).safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "settings required");
        return;
      }
      try {
        writeSettings(me.persistentId, body.data.settings);
      } catch {
        fail(res, 413, "Settings too large");
        return;
      }
      res.json({ ok: true });
    }),
  );

  router.get(
    "/users",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      const users = store.list().map((u) => ({
        ...u,
        stats: readStats(store.find(u.username)!.persistentId),
      }));
      res.json({ users, maxAccounts: maxAccounts(), maxDevices: maxDevices() });
    }),
  );

  router.post(
    "/users",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = CreateSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "Username and password required");
        return;
      }
      const a = store.create(
        body.data.username,
        body.data.password,
        body.data.role,
      );
      res.status(201).json({ username: a.username, role: a.role });
    }),
  );

  router.post(
    "/users/:name/password",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = PasswordSchema.safeParse(req.body);
      if (!body.success) {
        fail(res, 400, "Password required");
        return;
      }
      store.setPassword(String(req.params.name), body.data.password);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/users/:name/disabled",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      const disabled = z.object({ disabled: z.boolean() }).safeParse(req.body);
      if (!disabled.success) {
        fail(res, 400, "disabled: true/false required");
        return;
      }
      store.setDisabled(String(req.params.name), disabled.data.disabled);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/users/:name/role",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      const role = z
        .object({ role: z.enum(["admin", "player"]) })
        .safeParse(req.body);
      if (!role.success) {
        fail(res, 400, "role: admin/player required");
        return;
      }
      store.setRole(String(req.params.name), role.data.role);
      res.json({ ok: true });
    }),
  );

  router.delete(
    "/users/:name",
    handle((req, res) => {
      const me = requireAdmin(req, res);
      if (!me) return;
      if (String(req.params.name).toLowerCase() === me.username.toLowerCase()) {
        fail(res, 400, "You cannot remove yourself");
        return;
      }
      const gone = store.find(String(req.params.name));
      store.remove(String(req.params.name));
      if (gone) forgetAccount(gone.persistentId);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/users/:name/approve",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      store.approve(String(req.params.name));
      res.json({ ok: true });
    }),
  );

  router.delete(
    "/users/:name/devices",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      store.removeDevice(String(req.params.name), null);
      res.json({ ok: true });
    }),
  );

  router.delete(
    "/users/:name/devices/:id",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      store.removeDevice(String(req.params.name), String(req.params.id));
      res.json({ ok: true });
    }),
  );

  return router;
}

/**
 * Create the first admin from SELFHOST_ADMIN_USER / SELFHOST_ADMIN_PASSWORD
 * when no accounts exist yet. Returns a message for the log.
 */
export function bootstrapAdmin(): string {
  const store = accountStore();
  if (store.count() > 0) return `self-host: ${store.count()} account(s)`;
  const user = process.env.SELFHOST_ADMIN_USER;
  const pass = process.env.SELFHOST_ADMIN_PASSWORD;
  if (!user || !pass) {
    return "self-host: no accounts yet — set SELFHOST_ADMIN_USER and SELFHOST_ADMIN_PASSWORD, or run `npm run selfhost:admin -- <user> <password>`";
  }
  store.create(user, pass, "admin");
  return `self-host: created admin account "${user}"`;
}
