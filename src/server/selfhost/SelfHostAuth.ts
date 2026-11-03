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
  // Device limit: the token's device must still hold a slot (an admin can
  // free it, which signs that device out).
  if (
    payload.d === undefined ||
    !accountStore().hasDevice(account, payload.d)
  ) {
    return null;
  }
  return account;
}

/** "Bearer <token>" → account, for HTTP routes. */
export function sessionFromAuthHeader(
  header: string | undefined,
): { account: Account; deviceId: string } | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const account = accountForToken(token);
  if (account === null) return null;
  const payload = verifySessionToken(token, sessionSecret());
  return payload?.d ? { account, deviceId: payload.d } : null;
}

export function accountFromAuthHeader(
  header: string | undefined,
): Account | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  return accountForToken(header.slice("Bearer ".length).trim());
}
