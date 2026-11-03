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
/** This browser/app install's id for the device limit (kept on logout). */
const DEVICE_KEY = "laukolaroser.device";
/** Settings last pushed to the server (to send only real changes). */
const SYNCED_KEY = "laukolaroser.synced-settings";
const USERNAME_KEY = "username"; // the name box on the homepage

export interface SelfHostSession {
  token: string;
  username: string;
  role: "admin" | "player";
}

export interface SelfHostStats {
  games: number;
  wins: number;
  soloGames: number;
  soloWins: number;
  playSeconds: number;
  lastPlayed: number;
}

export interface SelfHostUser {
  username: string;
  role: "admin" | "player";
  disabled: boolean;
  createdAt: number;
  pending: boolean;
  devices: { id: string; name: string; lastSeen: number }[];
  stats: SelfHostStats;
}

let enabled: boolean | null = null;
let ownServer = false;
let registration = false;
let deviceLimit = 2;
let myStats: SelfHostStats | null = null;

/** Whether players may request access on this server. */
export function registrationOpen(): boolean {
  return registration;
}

export function maxDevices(): number {
  return deviceLimit;
}

/** The signed-in player's stats (after validateSession). */
export function ownStats(): SelfHostStats | null {
  return myStats;
}

/** A stable id for this browser / app install. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "nostorage-device";
  }
}

/** A readable device label for the admin list ("Android phone", …). */
export function deviceName(ua = navigator.userAgent): string {
  const app = /LaukolaroserApp/i.test(ua) ? " (app)" : "";
  if (/Android/i.test(ua))
    return `Android${/Mobile/i.test(ua) ? " phone" : " tablet"}${app}`;
  if (/iPhone/i.test(ua)) return `iPhone${app}`;
  if (/iPad/i.test(ua)) return `iPad${app}`;
  if (/Windows/i.test(ua)) return `Windows PC${app}`;
  if (/Mac OS X|Macintosh/i.test(ua)) return `Mac${app}`;
  if (/Linux/i.test(ua)) return `Linux PC${app}`;
  return `Device${app}`;
}

/** Whether this server runs in self-hosted mode (cached after first call). */
export async function detectSelfHost(): Promise<boolean> {
  if (enabled !== null) return enabled;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("/api/selfhost/status", { signal: ctrl.signal });
    clearTimeout(timer);
    const body = res.ok
      ? ((await res.json()) as {
          enabled?: boolean;
          ownServer?: boolean;
          registration?: boolean;
          maxDevices?: number;
        })
      : {};
    enabled = body.enabled === true;
    ownServer = body.ownServer === true;
    registration = body.registration === true;
    deviceLimit = body.maxDevices ?? 2;
  } catch {
    enabled = false;
  }
  return enabled;
}

/**
 * True on a Laukolaroser server you run yourself (private or public mode):
 * lobbies and games need only that server, not the upstream API.
 */
export function isOwnServer(): boolean {
  return ownServer || enabled === true;
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
    { username, password, deviceId: deviceId(), deviceName: deviceName() },
    false,
  );
  save(s);
  return s;
}

/** Ask the admin for an account (approved later in the admin panel). */
export async function requestAccess(
  username: string,
  password: string,
): Promise<void> {
  await api("POST", "/register", { username, password }, false);
}

export function logout(): void {
  save(null);
}

/** Re-checks the stored session with the server; clears it if invalid. */
export async function validateSession(): Promise<SelfHostSession | null> {
  const s = currentSession();
  if (s === null) return null;
  try {
    const me = await api<{
      username: string;
      role: SelfHostSession["role"];
      stats?: SelfHostStats;
    }>("GET", "/me");
    myStats = me.stats ?? null;
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

/** Record a finished solo game in this account's stats. */
export async function reportSoloGame(
  won: boolean,
  seconds: number,
): Promise<void> {
  if (!isSelfHosted() || currentSession() === null) return;
  await api("POST", "/stats/solo", { won, seconds });
}

// ---------------------------------------------------------------- settings

/** Settings that follow the player to every device. Graphics stay local. */
export function isSyncedSettingKey(key: string): boolean {
  return (
    key.startsWith("settings.") &&
    !/graphics|quality|renderer|performance/i.test(key)
  );
}

function localSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === null || !isSyncedSettingKey(k)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  } catch {
    // no storage
  }
  return out;
}

/**
 * Load the account's settings from the server into this device (before
 * the app reads them), then keep pushing local changes every 20 s and when
 * the page is hidden.
 */
export async function startSettingsSync(): Promise<void> {
  try {
    const { settings } = await api<{ settings: Record<string, string> }>(
      "GET",
      "/settings",
    );
    if (Object.keys(settings).length > 0) {
      for (const [k, v] of Object.entries(settings)) {
        if (isSyncedSettingKey(k)) localStorage.setItem(k, v);
      }
    }
    localStorage.setItem(SYNCED_KEY, JSON.stringify(localSettings()));
  } catch {
    // Offline or older server: keep the local settings.
  }
  const push = () => {
    try {
      const now = JSON.stringify(localSettings());
      if (now === localStorage.getItem(SYNCED_KEY)) return;
      localStorage.setItem(SYNCED_KEY, now);
      void api("PUT", "/settings", { settings: JSON.parse(now) }).catch(() =>
        localStorage.removeItem(SYNCED_KEY),
      );
    } catch {
      // ignore
    }
  };
  setInterval(push, 20_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") push();
  });
}

export const adminApi = {
  list: () =>
    api<{ users: SelfHostUser[]; maxAccounts: number; maxDevices: number }>(
      "GET",
      "/users",
    ),
  approve: (username: string) =>
    api("POST", `/users/${encodeURIComponent(username)}/approve`),
  resetDevices: (username: string) =>
    api("DELETE", `/users/${encodeURIComponent(username)}/devices`),
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
