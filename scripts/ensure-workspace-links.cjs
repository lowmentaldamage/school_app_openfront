/**
 * Make sure node_modules/@laukolaroser/<pkg> point at packages/<pkg>.
 *
 * npm creates these workspace links on install, but a zip (the Windows
 * test build) cannot carry them, so the launcher recreates them on first
 * start. On Windows they are directory junctions, which need no admin
 * rights. Safe to call every time: existing links are left alone.
 */

const fs = require("fs");
const path = require("path");

function ensureWorkspaceLinks(root) {
  const pkgs = path.join(root, "packages");
  const scope = path.join(root, "node_modules", "@laukolaroser");
  if (!fs.existsSync(pkgs)) return 0;
  fs.mkdirSync(scope, { recursive: true });
  let made = 0;
  for (const name of fs.readdirSync(pkgs)) {
    const target = path.join(pkgs, name);
    if (!fs.existsSync(path.join(target, "package.json"))) continue;
    const link = path.join(scope, name);
    let ok = false;
    try {
      ok = fs.realpathSync(link) === fs.realpathSync(target);
    } catch {
      ok = false;
    }
    if (ok) continue;
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    made++;
  }
  return made;
}

module.exports = { ensureWorkspaceLinks };
