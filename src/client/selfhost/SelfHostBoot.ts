/**
 * Startup hook for self-hosted servers (called first thing in Main).
 *
 * Returns true when the app may continue: either the server is not
 * self-hosted, or the stored session is valid (then the account chip and
 * admin panel are mounted). Otherwise shows the login screen and returns
 * false; a successful login reloads the page.
 */

import "./SelfHostAccount";
import "./SelfHostAdmin";
import "./SelfHostLogin";
import {
  detectSelfHost,
  startSettingsSync,
  validateSession,
} from "./SelfHostSession";

export async function startSelfHostSession(): Promise<boolean> {
  if (!(await detectSelfHost())) return true;
  const session = await validateSession();
  if (session === null) {
    document.body.appendChild(document.createElement("selfhost-login"));
    return false;
  }
  // Settings follow the account across devices.
  await startSettingsSync();
  document.body.append(
    document.createElement("selfhost-account"),
    document.createElement("selfhost-admin"),
  );
  hideOnlineAccountFeatures();
  return true;
}

/**
 * The original online-account features (sign-in, store, inventory, global
 * leaderboard, clans) need an external API a private server doesn't have;
 * hide their entry points instead of showing buttons that cannot work.
 */
function hideOnlineAccountFeatures(): void {
  const style = document.createElement("style");
  style.id = "selfhost-hide-online";
  style.textContent = [
    '[data-page="page-item-store"]',
    '[data-page="page-inventory"]',
    '[data-page="page-leaderboard"]',
    '[data-page="page-clan"]',
    "nav-account-menu",
  ]
    .map((sel) => `${sel} { display: none !important; }`)
    .join("\n");
  document.head.appendChild(style);
}
