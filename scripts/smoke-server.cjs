#!/usr/bin/env node
/**
 * Cross-platform smoke test of the game server (Windows, macOS, Linux):
 * starts it in private (self-hosted) mode with a fresh data folder, waits
 * for /api/selfhost/status, logs in as the bootstrap admin and checks the
 * session, then stops it. Exit code 0 = the server works on this machine.
 *
 *   npm run smoke:server
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "laukolaroser-smoke-"));
const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
require("./ensure-workspace-links.cjs").ensureWorkspaceLinks(ROOT);

const child = spawn(
  process.execPath,
  [tsxCli, path.join("src", "server", "Server.ts")],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      GAME_ENV: "dev",
      SELF_HOSTED: "1",
      SELFHOST_DATA_DIR: dataDir,
      SELFHOST_ADMIN_USER: "smokeadmin",
      SELFHOST_ADMIN_PASSWORD: "smoke-password-1",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      API_KEY: "smoke",
      ADMIN_BOT_API_KEY: "smoke",
      DOMAIN: "localhost",
      GIT_COMMIT: "smoke",
      NUM_WORKERS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

function finish(code, message) {
  console.log(message);
  if (code !== 0) console.log("--- server output ---\n" + log.slice(-4000));
  child.kill();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(code);
}

async function waitForStatus(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/selfhost/status`);
      if (r.ok) return await r.json();
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return null;
}

void (async () => {
  child.on("exit", (code) =>
    finish(1, `FAIL: server exited early with code ${code}`),
  );
  const status = await waitForStatus(Date.now() + 120_000);
  if (status === null) return finish(1, "FAIL: server did not start in 120 s");
  if (status.enabled !== true) {
    return finish(1, `FAIL: unexpected status ${JSON.stringify(status)}`);
  }
  const login = await fetch(`${BASE}/api/selfhost/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "smokeadmin",
      password: "smoke-password-1",
      // Sign-ins are bound to a device (2 devices per account).
      deviceId: "smoke-test-device-1",
      deviceName: "Smoke test",
    }),
  });
  if (!login.ok) return finish(1, `FAIL: login HTTP ${login.status}`);
  const { token } = await login.json();
  const me = await fetch(`${BASE}/api/selfhost/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!me.ok) return finish(1, `FAIL: /me HTTP ${me.status}`);
  const who = await me.json();
  child.removeAllListeners("exit");
  finish(
    0,
    `OK: server up on ${os.platform()} ${os.arch()}, node ${process.version}; ` +
      `logged in as ${who.username ?? JSON.stringify(who)}`,
  );
})();
