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

  it("rate limits repeated login attempts", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await call("POST", "/login", { username: "boss", password: "wrong" })
      ).status;
    }
    expect(last).toBe(429);
  });
});
