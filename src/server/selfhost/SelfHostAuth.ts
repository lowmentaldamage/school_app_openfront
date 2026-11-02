/**
 * Verifying self-hosted session tokens against the live account list.
 * Shared by the master (HTTP routes) and workers (game joins).
 */

import { AccountStore, type Account } from "./AccountStore";
import { selfHostDataDir, sessionSecret } from "./SelfHost";
import { verifySessionToken } from "./SessionToken";

let store: AccountStore | null = null;

export function accountStore(): AccountStore {
  store ??= AccountStore.inDir(selfHostDataDir());
  return store;
}

/**
 * The account behind a session token, or null when the token is forged,
 * expired, or its account was removed, disabled or had its password reset.
 */
export function accountForToken(token: string): Account | null {
  const payload = verifySessionToken(token, sessionSecret());
  if (payload === null) return null;
  const account = accountStore().findById(payload.sub);
  if (!account || account.disabled || account.version !== payload.v) {
    return null;
  }
  return account;
}

/** "Bearer <token>" → account, for HTTP routes. */
export function accountFromAuthHeader(
  header: string | undefined,
): Account | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  return accountForToken(header.slice("Bearer ".length).trim());
}
