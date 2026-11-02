/**
 * HTTP API for self-hosted accounts, mounted on the master at /api/selfhost.
 *
 *   GET    /status                      → { enabled: true }
 *   POST   /login        {username,password}           → { token, username, role }
 *   GET    /me           (Bearer)       → { username, role }
 *   POST   /password     (Bearer) {current, password}  → change own password
 *   Admin only (Bearer, role admin):
 *   GET    /users                       → PublicAccount[]
 *   POST   /users        {username, password, role?}   → create
 *   POST   /users/:name/password {password}            → reset password
 *   POST   /users/:name/disabled {disabled}            → enable/disable
 *   POST   /users/:name/role     {role}                → admin/player
 *   DELETE /users/:name                                → remove
 *
 * Login attempts are rate limited per IP. Every change takes effect at
 * once: tokens are re-checked against the account list on every join.
 */

import express, { type Request, type Response } from "express";
import { z } from "zod";
import { AccountError, type Account } from "./AccountStore";
import { sessionSecret } from "./SelfHost";
import { accountFromAuthHeader, accountStore } from "./SelfHostAuth";
import { issueSessionToken } from "./SessionToken";

const LoginSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(200),
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

function tokenFor(account: Account): string {
  return issueSessionToken(
    {
      sub: account.persistentId,
      u: account.username,
      r: account.role,
      v: account.version,
    },
    sessionSecret(),
  );
}

export function createSelfHostRouter(): express.Router {
  const router = express.Router();
  const limiter = new LoginLimiter();
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
    res.json({ enabled: true });
  });

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
      const account = store.authenticate(
        body.data.username,
        body.data.password,
      );
      if (account === null) {
        limiter.recordFailure(ip);
        fail(res, 401, "Wrong username or password");
        return;
      }
      res.json({
        token: tokenFor(account),
        username: account.username,
        role: account.role,
      });
    }),
  );

  router.get(
    "/me",
    handle((req, res) => {
      const me = accountFromAuthHeader(req.headers.authorization);
      if (me === null) {
        fail(res, 401, "Please log in");
        return;
      }
      res.json({ username: me.username, role: me.role });
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
      res.json({ token: tokenFor(store.find(me.username)!) });
    }),
  );

  router.get(
    "/users",
    handle((req, res) => {
      if (!requireAdmin(req, res)) return;
      res.json({ users: store.list() });
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
      store.remove(String(req.params.name));
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
