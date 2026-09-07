import { randomId } from "./ids";

const ANON_KEY = "tracki_anon";
const USER_KEY = "tracki_user";
const SESSION_KEY = "tracki_session";
const SESSION_TS_KEY = "tracki_session_ts";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * localStorage that never throws, with an in-memory fallback for environments
 * where it's unavailable or throws (Safari private mode, sandboxed iframes,
 * opaque origins). Identity then persists for the page lifetime at minimum.
 */
const memory = new Map<string, string>();

const store = {
  get(key: string): string | null {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch {
      /* fall through to memory */
    }
    return memory.has(key) ? (memory.get(key) as string) : null;
  },
  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* memory holds it */
    }
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function getAnonId(): string {
  let id = store.get(ANON_KEY);
  if (!id) {
    id = randomId("anon");
    store.set(ANON_KEY, id);
  }
  return id;
}

export function getUserId(): string | undefined {
  return store.get(USER_KEY) ?? undefined;
}

export function setUserId(userId: string): void {
  store.set(USER_KEY, userId);
}

/**
 * Returns the current session id, rotating it after 30 min of inactivity.
 * `now` is injectable for tests.
 */
export function getSessionId(now = Date.now()): string {
  const last = Number(store.get(SESSION_TS_KEY) ?? 0);
  let id = store.get(SESSION_KEY);
  if (!id || now - last > SESSION_TIMEOUT_MS) {
    id = randomId("sess");
    store.set(SESSION_KEY, id);
  }
  store.set(SESSION_TS_KEY, String(now));
  return id;
}

/** Test-only reset. */
export function __reset(): void {
  for (const k of [ANON_KEY, USER_KEY, SESSION_KEY, SESSION_TS_KEY]) store.remove(k);
}
