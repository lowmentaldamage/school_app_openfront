/**
 * Client side of self-hosted mode (server: src/server/selfhost/).
 *
 * The page asks the server once whether it runs in self-hosted mode
 * (GET /api/selfhost/status). If it does, the player must log in with an
 * account the admin created; the session token is kept in localStorage and
 * used as the game's play token (Auth.getPlayToken). Small and free of game
 * imports, so the homepage can load it.
 */

const SESSION_KEY = "laukolaroser.session";
const USERNAME_KEY = "username"; // the name box on the homepage

export interface SelfHostSession {
  token: string;
  username: string;
  role: "admin" | "player";
}

export interface SelfHostUser {
  username: string;
  role: "admin" | "player";
  disabled: boolean;
  createdAt: number;
}

let enabled: boolean | null = null;

/** Whether this server runs in self-hosted mode (cached after first call). */
export async function detectSelfHost(): Promise<boolean> {
  if (enabled !== null) return enabled;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("/api/selfhost/status", { signal: ctrl.signal });
    clearTimeout(timer);
    enabled =
      res.ok && ((await res.json()) as { enabled?: boolean }).enabled === true;
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Synchronous view once detectSelfHost() has resolved. */
export function isSelfHosted(): boolean {
  return enabled === true;
}

export function currentSession(): SelfHostSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SelfHostSession;
    return typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
}

/** The play token in self-hosted mode, else null. */
export function selfHostToken(): string | null {
  return isSelfHosted() ? (currentSession()?.token ?? null) : null;
}

function save(s: SelfHostSession | null): void {
  try {
    if (s === null) localStorage.removeItem(SESSION_KEY);
    else {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      // Show the account name in the name box (the server uses it anyway).
      localStorage.setItem(USERNAME_KEY, s.username);
    }
  } catch {
    // Private mode etc.: the session lasts for this page only.
  }
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  const token = currentSession()?.token;
  const res = await fetch(`/api/selfhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export async function login(
  username: string,
  password: string,
): Promise<SelfHostSession> {
  const s = await api<SelfHostSession>(
    "POST",
    "/login",
    { username, password },
    false,
  );
  save(s);
  return s;
}

export function logout(): void {
  save(null);
}

/** Re-checks the stored session with the server; clears it if invalid. */
export async function validateSession(): Promise<SelfHostSession | null> {
  const s = currentSession();
  if (s === null) return null;
  try {
    const me = await api<{ username: string; role: SelfHostSession["role"] }>(
      "GET",
      "/me",
    );
    const fresh = { ...s, username: me.username, role: me.role };
    save(fresh);
    return fresh;
  } catch {
    save(null);
    return null;
  }
}

export async function changeOwnPassword(
  current: string,
  password: string,
): Promise<void> {
  const { token } = await api<{ token: string }>("POST", "/password", {
    current,
    password,
  });
  const s = currentSession();
  if (s) save({ ...s, token });
}

export const adminApi = {
  list: () =>
    api<{ users: SelfHostUser[] }>("GET", "/users").then((r) => r.users),
  create: (username: string, password: string, role: SelfHostUser["role"]) =>
    api("POST", "/users", { username, password, role }),
  resetPassword: (username: string, password: string) =>
    api("POST", `/users/${encodeURIComponent(username)}/password`, {
      password,
    }),
  setDisabled: (username: string, disabled: boolean) =>
    api("POST", `/users/${encodeURIComponent(username)}/disabled`, {
      disabled,
    }),
  setRole: (username: string, role: SelfHostUser["role"]) =>
    api("POST", `/users/${encodeURIComponent(username)}/role`, { role }),
  remove: (username: string) =>
    api("DELETE", `/users/${encodeURIComponent(username)}`),
};
