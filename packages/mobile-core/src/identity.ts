import type { Clock, KeyValueStorage } from "./types";

const ANON_KEY = "tracki_anon";
const USER_KEY = "tracki_user";
const SESSION_KEY = "tracki_session";
const SESSION_TS_KEY = "tracki_session_ts";

/** Same rotation rule as the web snippet: 30 min of inactivity = new session. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export function defaultIdFactory(prefix: string): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

/**
 * Visitor identity over an injected async store. Hydrated once at init; all
 * reads are then synchronous in-memory, writes persist fire-and-forget (the
 * memory copy is authoritative for the process lifetime — mirroring the
 * snippet's localStorage-with-memory-fallback semantics).
 */
export class Identity {
  private anonId = "";
  private userId: string | undefined;
  private sessionId = "";
  private lastActivity = 0;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: Clock,
    private readonly newId: (prefix: string) => string = defaultIdFactory,
  ) {}

  /** Load persisted identity; create what's missing. Call once before use. */
  async hydrate(): Promise<void> {
    const [anon, user, sess, ts] = await Promise.all([
      this.storage.get(ANON_KEY).catch(() => null),
      this.storage.get(USER_KEY).catch(() => null),
      this.storage.get(SESSION_KEY).catch(() => null),
      this.storage.get(SESSION_TS_KEY).catch(() => null),
    ]);
    this.anonId = anon || this.persist(ANON_KEY, this.newId("anon"));
    this.userId = user || undefined;
    this.sessionId = sess || "";
    this.lastActivity = Number(ts ?? 0) || 0;
    // Ensure a valid session exists (also rotates an expired persisted one).
    this.touchSession();
  }

  private persist(key: string, value: string): string {
    void this.storage.set(key, value).catch(() => {});
    return value;
  }

  getAnonId(): string {
    return this.anonId;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  setUserId(userId: string): void {
    this.userId = userId;
    this.persist(USER_KEY, userId);
  }

  /** Current session id; rotates after 30 min of inactivity, stamps activity. */
  touchSession(): string {
    const t = this.now();
    if (!this.sessionId || t - this.lastActivity > SESSION_TIMEOUT_MS) {
      this.sessionId = this.persist(SESSION_KEY, this.newId("sess"));
    }
    this.lastActivity = t;
    this.persist(SESSION_TS_KEY, String(t));
    return this.sessionId;
  }

  /** Read without stamping activity (used when building batches). */
  currentSession(): string {
    return this.sessionId;
  }
}
