import type postgres from "postgres";
import type { StateStore } from "./state";

/** Called under the project's transaction lock; state commits with inbox completion. */
export class DurableStateStore implements StateStore {
  constructor(
    private tx: postgres.TransactionSql,
    private now: number,
  ) {}
  async read(key: string): Promise<unknown> {
    const rows = await this.tx`SELECT value FROM telemetry_state WHERE key=${key}`;
    return rows[0]?.value;
  }
  async write(key: string, value: postgres.JSONValue): Promise<void> {
    await this.tx`INSERT INTO telemetry_state (key,value,expires_at)
      VALUES (${key},${this.tx.json(value)},now()+interval '48 hours')
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at`;
  }
  async pushTimestamped(key: string, ts: number, windowMs: number): Promise<number> {
    const old = await this.read(key);
    const arr = Array.isArray(old) ? (old as number[]) : [];
    const kept = [...arr.filter((t) => t > ts - windowMs && t <= ts), ts];
    // Count is saturated above all thresholds; bound hostile burst storage.
    await this.write(key, kept.slice(-1000));
    return kept.length;
  }
  async setFlagIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    if (await this.hasFlag(key)) return false;
    await this.setFlag(key, ttlMs);
    return true;
  }
  async setFlag(key: string, ttlMs: number): Promise<void> {
    await this.write(key, this.now + ttlMs);
  }
  async hasFlag(key: string): Promise<boolean> {
    return Number((await this.read(key)) ?? 0) > this.now;
  }
}
