import { redis } from "./redis.js";

/**
 * Minimal state primitives the struggle detector needs. Abstracted so the
 * detector has zero Redis coupling and can be unit-tested with the in-memory
 * implementation below.
 */
export interface StateStore {
  /** Add ts to a sliding window, drop entries older than windowMs, return count. */
  pushTimestamped(key: string, ts: number, windowMs: number): Promise<number>;
  /** Set key only if absent; true if it was set (used for debounce). */
  setFlagIfAbsent(key: string, ttlMs: number): Promise<boolean>;
  setFlag(key: string, ttlMs: number): Promise<void>;
  hasFlag(key: string): Promise<boolean>;
}

let seq = 0;
// Audit N3: process-unique prefix so sorted-set members can't collide with a
// still-live member from a previous process after a fast restart.
const MEMBER_PREFIX = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;

export class RedisStateStore implements StateStore {
  async pushTimestamped(key: string, ts: number, windowMs: number): Promise<number> {
    const r = redis();
    const member = `${ts}-${MEMBER_PREFIX}-${seq++}`;
    const pipe = r.pipeline();
    pipe.zadd(key, ts, member);
    pipe.zremrangebyscore(key, 0, ts - windowMs);
    pipe.zcard(key);
    pipe.pexpire(key, windowMs);
    const res = await pipe.exec();
    // zcard is the 3rd command (index 2): [err, value].
    const card = res?.[2]?.[1];
    return typeof card === "number" ? card : Number(card ?? 0);
  }

  async setFlagIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    const res = await redis().set(key, "1", "PX", ttlMs, "NX");
    return res === "OK";
  }

  async setFlag(key: string, ttlMs: number): Promise<void> {
    await redis().set(key, "1", "PX", ttlMs);
  }

  async hasFlag(key: string): Promise<boolean> {
    return (await redis().exists(key)) === 1;
  }
}

/** Deterministic in-memory store for tests. */
export class InMemoryStateStore implements StateStore {
  private windows = new Map<string, number[]>();
  private flags = new Map<string, number>();

  constructor(private now: () => number = () => Date.now()) {}

  async pushTimestamped(key: string, ts: number, windowMs: number): Promise<number> {
    const arr = this.windows.get(key) ?? [];
    arr.push(ts);
    const cutoff = ts - windowMs;
    const kept = arr.filter((t) => t > cutoff);
    this.windows.set(key, kept);
    return kept.length;
  }

  async setFlagIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    if (await this.hasFlag(key)) return false;
    this.flags.set(key, this.now() + ttlMs);
    return true;
  }

  async setFlag(key: string, ttlMs: number): Promise<void> {
    this.flags.set(key, this.now() + ttlMs);
  }

  async hasFlag(key: string): Promise<boolean> {
    const exp = this.flags.get(key);
    if (exp === undefined) return false;
    if (exp <= this.now()) {
      this.flags.delete(key);
      return false;
    }
    return true;
  }
}
