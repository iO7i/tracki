import type { Clock, KeyValueStorage } from "./types";

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export function defaultIdFactory(prefix: string): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

/** Non-secret deterministic storage partition. Never store an endpoint credential. */
export function storageNamespace(
  key: string,
  endpoint: string,
  environment = "production",
): string {
  let h = 2166136261;
  for (const c of `${key}|${endpoint}|${environment}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `tracki:v2:${(h >>> 0).toString(36)}`;
}

export class Identity {
  private anonId = "";
  private userId: string | undefined;
  private sessionId = "";
  private lastActivity = 0;
  private writes: Promise<void> = Promise.resolve();
  private restoredSession = false;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: Clock,
    private readonly newId: (prefix: string) => string = defaultIdFactory,
    private readonly namespace = "tracki:v2:default",
  ) {}

  private key(name: string): string {
    return `${this.namespace}:${name}`;
  }

  async hydrate(): Promise<void> {
    const [anon, user, sess, ts] = await Promise.all(
      ["anon", "user", "session", "session_ts"].map((name) =>
        this.storage.get(this.key(name)).catch(() => null),
      ),
    );
    this.anonId = anon || this.persist("anon", this.newId("anon"));
    this.userId = user || undefined;
    this.sessionId = sess || "";
    this.restoredSession = !!sess;
    this.lastActivity = Number(ts ?? 0) || 0;
    this.touchSession();
    await this.writes;
  }

  private persist(name: string, value: string): string {
    this.writes = this.writes.then(() => this.storage.set(this.key(name), value)).catch(() => {});
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
    this.persist("user", userId);
  }

  touchSession(): string {
    const t = this.now();
    if (!this.sessionId || t - this.lastActivity > SESSION_TIMEOUT_MS) this.rotateSession();
    this.lastActivity = t;
    this.persist("session_ts", String(t));
    return this.sessionId;
  }

  rotateSession(): void {
    this.sessionId = this.persist("session", this.newId("sess"));
    this.lastActivity = this.now();
    this.persist("session_ts", String(this.lastActivity));
  }

  currentSession(): string {
    return this.sessionId;
  }
  /** Installed binary/update changes start a new session. Historical queue
   * envelopes retain their previous session and grant rather than relabeling. */
  async bindBuild(signature: string): Promise<void> {
    let previous: string | null = null;
    try { previous = await this.storage.get(this.key("build_signature")); } catch { /* unavailable persistence must not affect the app */ }
    if ((previous !== null && previous !== signature) || (previous === null && this.restoredSession)) this.rotateSession();
    this.persist("build_signature", signature);
    await this.writes;
  }

  /** Logout clears this namespace only; serialized writes cannot restore the old user. */
  async reset(): Promise<void> {
    this.userId = undefined;
    this.anonId = this.newId("anon");
    this.rotateSession();
    this.persist("anon", this.anonId);
    this.writes = this.writes
      .then(() =>
        this.storage.remove
          ? this.storage.remove(this.key("user"))
          : this.storage.set(this.key("user"), ""),
      )
      .catch(() => {});
    await this.writes;
  }
}
