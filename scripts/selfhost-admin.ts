/**
 * Manage self-hosted accounts from the server's shell (e.g. to create the
 * first admin, or recover if you lock yourself out).
 *
 *   npm run selfhost:admin -- add <username> <password> [admin|player]
 *   npm run selfhost:admin -- passwd <username> <new-password>
 *   npm run selfhost:admin -- remove <username>
 *   npm run selfhost:admin -- disable|enable <username>
 *   npm run selfhost:admin -- list
 *
 * Uses SELFHOST_DATA_DIR (default ./data), the same as the server. Changes
 * apply immediately, without a restart.
 */

import {
  AccountError,
  AccountStore,
} from "../src/server/selfhost/AccountStore";
import { selfHostDataDir } from "../src/server/selfhost/SelfHost";

const [cmd, a, b, c] = process.argv.slice(2);
const store = AccountStore.inDir(selfHostDataDir());

function usage(): never {
  console.log(
    "usage: selfhost:admin -- add <user> <password> [admin|player] | passwd <user> <password> | remove <user> | disable <user> | enable <user> | approve <user> | devices <user> | unlock <user> | list",
  );
  process.exit(1);
}

try {
  switch (cmd) {
    case "add": {
      if (!a || !b) usage();
      const role =
        c === "player"
          ? "player"
          : c === "admin" || store.count() === 0
            ? "admin"
            : "player";
      store.create(a, b, role);
      console.log(`created ${role} "${a}"`);
      break;
    }
    case "passwd":
      if (!a || !b) usage();
      store.setPassword(a, b);
      console.log(
        `password changed for "${a}" (their sessions were logged out)`,
      );
      break;
    case "remove":
      if (!a) usage();
      store.remove(a);
      console.log(`removed "${a}"`);
      break;
    case "disable":
    case "enable":
      if (!a) usage();
      store.setDisabled(a, cmd === "disable");
      console.log(`${cmd}d "${a}"`);
      break;
    case "approve":
      if (!a) usage();
      store.approve(a);
      console.log(`approved "${a}"`);
      break;
    case "unlock":
      if (!a) usage();
      store.unlock(a);
      console.log(`unlocked "${a}"`);
      break;
    case "devices":
      if (!a) usage();
      store.removeDevice(a, null);
      console.log(`freed all devices of "${a}" (they were signed out)`);
      break;
    case "list":
      for (const u of store.list()) {
        console.log(
          `${u.username.padEnd(24)} ${u.role.padEnd(7)} ${String(u.devices.length).padStart(1)} device(s) ${u.pending ? "REQUEST" : u.locked ? "LOCKED" : u.disabled ? "disabled" : ""}`,
        );
      }
      break;
    default:
      usage();
  }
} catch (e) {
  if (e instanceof AccountError) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
