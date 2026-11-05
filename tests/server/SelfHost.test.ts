import express from "express";
import fs from "fs";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccountError,
  AccountStore,
  hashPassword,
  verifyPassword,
} from "../../src/server/selfhost/AccountStore";
import {
  issueSessionToken,
  verifySessionToken,
} from "../../src/server/selfhost/SessionToken";

const secret = Buffer.alloc(48, 7);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "selfhost-"));
}

describe("passwords", () => {
  it("hash and verify; wrong passwords fail; hashes are salted", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(hashPassword("correct horse")).not.toBe(h);
    expect(h).not.toContain("correct");
  });
});

describe("session tokens", () => {
  const payload = {
    sub: "0b8f7c4e-2f9b-4a8e-9c1d-3e5f6a7b8c9d",
    u: "alice",
    r: "player" as const,
    v: 0,
  };

  it("round-trip, as a JWT the join schema accepts", async () => {
    const { z } = await import("zod");
    const t = issueSessionToken(payload, secret);
    expect(z.jwt().safeParse(t).success).toBe(true);
    expect(verifySessionToken(t, secret)?.u).toBe("alice");
  });

  it("reject forged, tampered, wrong-key and expired tokens", () => {
    const t = issueSessionToken(payload, secret);
    const [prefix, body, sig] = t.split(".");
    const evil = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString()),
        r: "admin",
      }),
    ).toString("base64url");
    expect(verifySessionToken(`${prefix}.${evil}.${sig}`, secret)).toBeNull();
    expect(verifySessionToken(t, Buffer.alloc(48, 8))).toBeNull();
    expect(verifySessionToken("a.b.c", secret)).toBeNull();
    expect(verifySessionToken("not-a-token", secret)).toBeNull();
    const old = issueSessionToken(payload, secret, 1000);
    expect(verifySessionToken(old, secret, 1000 + 31 * 24 * 3600)).toBeNull();
  });
});

describe("AccountStore", () => {
  it("creates, authenticates, lists without hashes, and persists", () => {
    const dir = tmpDir();
    const s = AccountStore.inDir(dir);
    s.create("boss", "secret123", "admin");
    s.create("Player_1", "hunter22", "player");
    expect(s.authenticate("boss", "secret123")?.role).toBe("admin");
    expect(s.authenticate("player_1", "hunter22")?.username).toBe("Player_1");
    expect(s.authenticate("boss", "nope")).toBeNull();
    expect(s.authenticate("ghost", "x")).toBeNull();
    expect(JSON.stringify(s.list())).not.toContain("scrypt");
    // A second instance (another process) sees the same accounts.
    expect(AccountStore.inDir(dir).count()).toBe(2);
  });

  it("validates input and protects the last admin", () => {
    const s = AccountStore.inDir(tmpDir());
    expect(() => s.create("x", "longenough", "player")).toThrow(AccountError);
    expect(() => s.create("valid_name", "123", "player")).toThrow(AccountError);
    s.create("boss", "secret123", "admin");
    expect(() => s.create("BOSS", "secret123", "player")).toThrow(/exists/);
    expect(() => s.remove("boss")).toThrow(/last admin/);
    expect(() => s.setDisabled("boss", true)).toThrow(/last admin/);
    expect(() => s.setRole("boss", "player")).toThrow(/last admin/);
  });

  it("password reset and disabling invalidate old sessions (version bump)", () => {
    const s = AccountStore.inDir(tmpDir());
    s.create("boss", "secret123", "admin");
    const p = s.create("pat", "secret123", "player");
    const v0 = p.version;
    s.setPassword("pat", "newpass99");
    expect(s.find("pat")!.version).toBe(v0 + 1);
    expect(s.authenticate("pat", "secret123")).toBeNull();
    expect(s.authenticate("pat", "newpass99")).not.toBeNull();
    s.setDisabled("pat", true);
    expect(s.authenticate("pat", "newpass99")).toBeNull();
  });
});

describe("self-host HTTP API", () => {
  let base = "";
  let server: ReturnType<express.Express["listen"]>;
  const dir = tmpDir();

  beforeAll(async () => {
    process.env.SELFHOST_DATA_DIR = dir;
    process.env.SELFHOST_ADMIN_USER = "boss";
    process.env.SELFHOST_ADMIN_PASSWORD = "secret123";
    const { createSelfHostRouter, bootstrapAdmin } =
      await import("../../src/server/selfhost/SelfHostRoutes");
    expect(bootstrapAdmin()).toContain('created admin account "boss"');
    const app = express();
    app.use(express.json());
    app.use("/api/selfhost", createSelfHostRouter());
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/selfhost`;
  });
  afterAll(() => server.close());

  const call = async (
    method: string,
    p: string,
    body?: unknown,
    token?: string,
  ) => {
    // Logins come from one test device unless the test names another.
    if (p === "/login" && body && typeof body === "object") {
      body = { deviceId: "test-device-0001", deviceName: "Test", ...body };
    }
    const res = await fetch(base + p, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      json: (await res.json()) as Record<string, unknown>,
    };
  };

  it("admin logs in, adds a player; the player can log in but not manage users", async () => {
    const login = await call("POST", "/login", {
      username: "boss",
      password: "secret123",
    });
    expect(login.status).toBe(200);
    const admin = login.json.token as string;

    expect(
      (
        await call(
          "POST",
          "/users",
          { username: "pat", password: "pat12345" },
          admin,
        )
      ).status,
    ).toBe(201);
    const users = await call("GET", "/users", undefined, admin);
    expect(
      (users.json.users as { username: string }[]).map((u) => u.username),
    ).toEqual(["boss", "pat"]);

    const pat = (
      await call("POST", "/login", { username: "pat", password: "pat12345" })
    ).json.token as string;
    expect((await call("GET", "/me", undefined, pat)).json.username).toBe(
      "pat",
    );
    expect((await call("GET", "/users", undefined, pat)).status).toBe(403);
    expect(
      (
        await call(
          "POST",
          "/users",
          { username: "x2", password: "abcdefg" },
          pat,
        )
      ).status,
    ).toBe(403);
    expect((await call("GET", "/users")).status).toBe(401);
  });

  it("rejects bad logins and ends sessions when the admin resets a password", async () => {
    expect(
      (await call("POST", "/login", { username: "boss", password: "nope" }))
        .status,
    ).toBe(401);
    const admin = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    const pat = (
      await call("POST", "/login", { username: "pat", password: "pat12345" })
    ).json.token as string;
    expect(
      (
        await call(
          "POST",
          "/users/pat/password",
          { password: "fresh777" },
          admin,
        )
      ).status,
    ).toBe(200);
    expect((await call("GET", "/me", undefined, pat)).status).toBe(401);
    expect(
      (await call("POST", "/login", { username: "pat", password: "fresh777" }))
        .status,
    ).toBe(200);
  });

  it("removed players can no longer use their token; admins cannot remove themselves", async () => {
    const admin = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    const pat = (
      await call("POST", "/login", { username: "pat", password: "fresh777" })
    ).json.token as string;
    expect((await call("DELETE", "/users/pat", undefined, admin)).status).toBe(
      200,
    );
    expect((await call("GET", "/me", undefined, pat)).status).toBe(401);
    expect((await call("DELETE", "/users/boss", undefined, admin)).status).toBe(
      400,
    );
  });

  it("game joins accept only valid accounts and use the account name", async () => {
    process.env.SELF_HOSTED = "1";
    const { verifyClientToken } = await import("../../src/server/jwt");
    const admin = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    const ok = await verifyClientToken(admin);
    expect(ok.type).toBe("success");
    if (ok.type === "success") expect(ok.selfHostUsername).toBe("boss");
    // Anonymous persistent ids (accepted in plain dev mode) are refused.
    expect(
      (await verifyClientToken("0b8f7c4e-2f9b-4a8e-9c1d-3e5f6a7b8c9d")).type,
    ).toBe("error");
    delete process.env.SELF_HOSTED;
  });

  it("access requests wait for an admin, then can sign in", async () => {
    const boss = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    expect(
      (
        await call("POST", "/register", {
          username: "newbie",
          password: "newbie123",
        })
      ).status,
    ).toBe(201);
    const early = await call("POST", "/login", {
      username: "newbie",
      password: "newbie123",
    });
    expect(early.status).toBe(403);
    expect(String(early.json.error)).toContain("waiting");
    const list = await call("GET", "/users", undefined, boss);
    const users = list.json.users as { username: string; pending: boolean }[];
    expect(users.find((u) => u.username === "newbie")?.pending).toBe(true);
    expect(list.json.maxAccounts).toBe(100);
    expect((await call("POST", "/users/newbie/approve", {}, boss)).status).toBe(
      200,
    );
    expect(
      (
        await call("POST", "/login", {
          username: "newbie",
          password: "newbie123",
        })
      ).status,
    ).toBe(200);
  });

  it("an account works on at most two devices; freeing them signs out", async () => {
    const boss = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    await call(
      "POST",
      "/users",
      { username: "duo", password: "duo12345" },
      boss,
    );
    const on = (deviceId: string) =>
      call("POST", "/login", {
        username: "duo",
        password: "duo12345",
        deviceId,
      });
    const a = await on("phone-aaaa-1111");
    expect(a.status).toBe(200);
    expect((await on("pc-bbbb-22222")).status).toBe(200);
    // Same device again is fine; a third is refused.
    expect((await on("phone-aaaa-1111")).status).toBe(200);
    const third = await on("tablet-cccc-333");
    expect(third.status).toBe(403);
    expect(String(third.json.error)).toContain("2 devices");
    // Admin frees the slots: old tokens stop working, a new device fits.
    const tokenA = a.json.token as string;
    expect((await call("GET", "/me", undefined, tokenA)).status).toBe(200);
    await call("DELETE", "/users/duo/devices", undefined, boss);
    expect((await call("GET", "/me", undefined, tokenA)).status).toBe(401);
    expect((await on("tablet-cccc-333")).status).toBe(200);
  });

  it("stats and settings follow the account", async () => {
    const t1 = (
      await call("POST", "/login", {
        username: "duo",
        password: "duo12345",
        deviceId: "tablet-cccc-333",
      })
    ).json.token as string;
    await call("POST", "/stats/solo", { won: true, seconds: 600 }, t1);
    await call("POST", "/stats/solo", { won: false, seconds: 300 }, t1);
    const me = await call("GET", "/me", undefined, t1);
    expect(me.json.stats).toMatchObject({
      soloGames: 2,
      soloWins: 1,
      playSeconds: 900,
    });
    await call(
      "PUT",
      "/settings",
      { settings: { "settings.darkMode": "true" } },
      t1,
    );
    const t2 = (
      await call("POST", "/login", {
        username: "duo",
        password: "duo12345",
        deviceId: "phone-dddd-4444",
      })
    ).json.token as string;
    expect(
      (await call("GET", "/settings", undefined, t2)).json.settings,
    ).toEqual({ "settings.darkMode": "true" });
  });

  it("multiplayer results are recorded from the game record", async () => {
    process.env.SELF_HOSTED = "1";
    const { accountStore } =
      await import("../../src/server/selfhost/SelfHostAuth");
    const { recordSelfHostedGame } =
      await import("../../src/server/selfhost/GameStats");
    const { readStats } = await import("../../src/server/selfhost/PlayerData");
    const duo = accountStore().find("duo")!;
    const boss = accountStore().find("boss")!;
    const n = recordSelfHostedGame({
      info: {
        config: { gameType: "Public" },
        duration: 1200,
        winner: ["player", "C1"],
        players: [
          { clientID: "C1", persistentID: duo.persistentId },
          { clientID: "C2", persistentID: boss.persistentId },
          { clientID: "C3", persistentID: null },
        ],
      },
    } as never);
    expect(n).toBe(2);
    expect(readStats(duo.persistentId)).toMatchObject({ games: 1, wins: 1 });
    expect(readStats(boss.persistentId)).toMatchObject({ games: 1, wins: 0 });
    delete process.env.SELF_HOSTED;
  });

  it("the account cap blocks new accounts and requests", async () => {
    process.env.SELFHOST_MAX_ACCOUNTS = "2";
    const r = await call("POST", "/register", {
      username: "late",
      password: "late12345",
    });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("full");
    delete process.env.SELFHOST_MAX_ACCOUNTS;
  });

  it("10 wrong passwords lock the account until the admin unlocks it", async () => {
    const boss = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    await call(
      "POST",
      "/users",
      { username: "lucky", password: "lucky123" },
      boss,
    );
    const tryPw = (password: string) =>
      call("POST", "/login", { username: "lucky", password });
    // A good login in between resets the count.
    for (let i = 0; i < 5; i++) await tryPw("nope");
    expect((await tryPw("lucky123")).status).toBe(200);
    let r = { status: 0, json: {} as Record<string, unknown> };
    for (let i = 0; i < 9; i++) r = await tryPw("nope");
    expect(r.status).toBe(401);
    expect(String(r.json.error)).toContain("1 try left");
    r = await tryPw("nope");
    expect(r.status).toBe(423);
    // Even the right password is refused now.
    expect((await tryPw("lucky123")).status).toBe(423);
    const list = (await call("GET", "/users", undefined, boss)).json.users as {
      username: string;
      locked: boolean;
    }[];
    expect(list.find((u) => u.username === "lucky")?.locked).toBe(true);
    // Players cannot unlock; the admin can.
    const pat = (await tryPw("lucky123")).json.token;
    expect(pat).toBeUndefined();
    expect((await call("POST", "/users/lucky/unlock", {}, boss)).status).toBe(
      200,
    );
    expect((await tryPw("lucky123")).status).toBe(200);
  });

  it("admins need a second step when 2FA is required; players do not", async () => {
    const { totpCode } = await import("../../src/server/selfhost/TwoFactor");
    const now = () => totpCode(secretOf, Math.floor(Date.now() / 30_000));
    let secretOf = "";
    const boss = (
      await call("POST", "/login", { username: "boss", password: "secret123" })
    ).json.token as string;
    await call(
      "POST",
      "/users",
      { username: "sec", password: "sec12345", role: "admin" },
      boss,
    );
    process.env.SELFHOST_ADMIN_2FA = "required";
    try {
      const step1 = await call("POST", "/login", {
        username: "sec",
        password: "sec12345",
      });
      expect(step1.status).toBe(200);
      expect(step1.json.token).toBeUndefined();
      expect(step1.json.twoFactor).toBe(true);
      const setup = step1.json.setup as { secret: string; uri: string };
      expect(setup.uri).toContain(setup.secret);
      secretOf = setup.secret;
      const ticket = step1.json.ticket as string;
      expect(
        (await call("POST", "/login/2fa", { ticket, code: "000000" })).status,
      ).toBe(401);
      const ok = await call("POST", "/login/2fa", { ticket, code: now() });
      expect(ok.status).toBe(200);
      expect(ok.json.role).toBe("admin");
      expect(typeof ok.json.token).toBe("string");

      // Set up now: the next sign-in asks only for the code.
      const again = await call("POST", "/login", {
        username: "sec",
        password: "sec12345",
      });
      expect(again.json.setup).toBeNull();
      expect(
        (
          await call("POST", "/login/2fa", {
            ticket: again.json.ticket,
            code: now(),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call("POST", "/login/2fa", {
            ticket: "forged.ticket",
            code: now(),
          })
        ).status,
      ).toBe(401);

      // Players still sign in with just the password.
      const player = await call("POST", "/login", {
        username: "lucky",
        password: "lucky123",
      });
      expect(typeof player.json.token).toBe("string");

      // Wrong codes count toward the lockout.
      process.env.SELFHOST_MAX_FAILED_LOGINS = "5";
      const t3 = (
        await call("POST", "/login", { username: "sec", password: "sec12345" })
      ).json.ticket;
      let r = 0;
      for (let i = 0; i < 5; i++) {
        r = (await call("POST", "/login/2fa", { ticket: t3, code: "111111" }))
          .status;
      }
      expect(r).toBe(423);
      expect(
        (await call("POST", "/login/2fa", { ticket: t3, code: now() })).status,
      ).toBe(423);
      expect((await call("POST", "/users/sec/unlock", {}, boss)).status).toBe(
        200,
      );

      // The admin reset removes the authenticator: setup starts over.
      const list = (await call("GET", "/users", undefined, boss)).json
        .users as {
        username: string;
        twoFactor: boolean;
      }[];
      expect(list.find((u) => u.username === "sec")?.twoFactor).toBe(true);
      expect(
        (await call("POST", "/users/sec/2fa-reset", {}, boss)).status,
      ).toBe(200);
      const fresh = await call("POST", "/login", {
        username: "sec",
        password: "sec12345",
      });
      expect(fresh.json.setup).not.toBeNull();
    } finally {
      delete process.env.SELFHOST_ADMIN_2FA;
      delete process.env.SELFHOST_MAX_FAILED_LOGINS;
    }
  });

  it("rate limits a flood of failed logins from one address", async () => {
    let last = 0;
    for (let i = 0; i < 35; i++) {
      last = (
        await call("POST", "/login", { username: "ghost", password: "wrong" })
      ).status;
    }
    expect(last).toBe(429);
  });
});
