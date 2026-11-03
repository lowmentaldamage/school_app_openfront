#!/usr/bin/env node
/**
 * One-click local server: starts Laukolaroser in private mode on this
 * computer, opens the game in the browser and prints the address phones
 * on the same Wi-Fi can use. Used by "Start Laukolaroser.bat" in the
 * Windows build, and by `npm run play` anywhere (after `npm run build-prod`).
 *
 * First start: asks for the admin username and password (stored hashed in
 * ./data). Stop with Ctrl+C or by closing the window.
 */

const { spawn, exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { ensureWorkspaceLinks } = require("./ensure-workspace-links.cjs");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 3000);
const DATA = path.resolve(
  process.env.SELFHOST_DATA_DIR ?? path.join(ROOT, "data"),
);
const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** Line reader shared by all prompts (piped input works too). */
let rl = null;
let mute = false;
const queued = [];
const waiting = [];
function reader() {
  if (rl) return rl;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  // Hide password typing: echo "*" instead of characters.
  rl._writeToOutput = (s) => {
    if (!mute || s.includes("\n") || s.includes("\r")) rl.output.write(s);
    else rl.output.write("*");
  };
  rl.on("line", (line) => {
    const w = waiting.shift();
    if (w) w(line.trim());
    else queued.push(line.trim());
  });
  return rl;
}

function ask(question, hidden = false) {
  const r = reader();
  process.stdout.write(question);
  mute = hidden;
  return new Promise((resolve) => {
    const done = (answer) => {
      mute = false;
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    };
    if (queued.length > 0) done(queued.shift());
    else waiting.push(done);
    void r;
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  console.log("\n  LAUKOLAROSER — local server\n");
  fs.mkdirSync(DATA, { recursive: true });
  const env = {
    ...process.env,
    GAME_ENV: "dev",
    SELF_HOSTED: "1",
    SELFHOST_DATA_DIR: DATA,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    API_KEY: "local",
    ADMIN_BOT_API_KEY: "local",
    DOMAIN: "localhost",
    GIT_COMMIT: process.env.GIT_COMMIT ?? "local",
    NUM_WORKERS: process.env.NUM_WORKERS ?? "2",
  };
  if (!fs.existsSync(path.join(DATA, "accounts.json"))) {
    console.log("  First start: create your admin account.\n");
    let user = "";
    while (!/^[A-Za-z0-9_.-]{3,24}$/.test(user)) {
      user = await ask("  Admin username (3-24 letters/digits): ");
    }
    let pass = "";
    while (pass.length < 6)
      pass = await ask("  Admin password (6+ characters): ", true);
    rl?.close();
    env.SELFHOST_ADMIN_USER = user;
    env.SELFHOST_ADMIN_PASSWORD = pass;
  }
  ensureWorkspaceLinks(ROOT);
  if (!fs.existsSync(tsxCli)) {
    console.error(
      "  Missing dependencies. Run `npm run inst` and `npm run build-prod` first.",
    );
    process.exit(1);
  }
  const child = spawn(
    process.execPath,
    [tsxCli, path.join("src", "server", "Server.ts")],
    {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (d) => (log = (log + d).slice(-8000)));
  child.stderr.on("data", (d) => (log = (log + d).slice(-8000)));
  child.on("exit", (code) => {
    console.log(`\n  Server stopped (code ${code}).`);
    if (code !== 0) console.log(log.slice(-3000));
    process.exit(code ?? 0);
  });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const url = `http://localhost:${PORT}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/selfhost/status`);
      if (r.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`  Ready!  Play here:            ${url}`);
  for (const ip of lanAddresses()) {
    console.log(`  Phones on the same Wi-Fi:    http://${ip}:${PORT}`);
  }
  console.log(
    "\n  Keep this window open while you play. Ctrl+C or close it to stop.",
  );
  console.log(`  Accounts and stats are stored in: ${DATA}\n`);
  openBrowser(url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
