import "server-only";

import { Redis } from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

/** A fresh subscriber connection (each SSE stream needs its own). */
export function createSubscriber(): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}

// Shared command connection for non-pub/sub use (rate limiting, etc.).
let command: Redis | null = null;
function redis(): Redis {
  if (!command) command = new Redis(url, { maxRetriesPerRequest: null });
  return command;
}

/**
 * Fixed-window per-key rate limit (Audit M2). Returns true if allowed.
 * Fails open if Redis is unreachable — limiting is a guard, not auth.
 */
export async function allowRate(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = await redis().incr(bucket);
    if (n === 1) await redis().expire(bucket, windowSec);
    return n <= limit;
  } catch {
    return true;
  }
}

export function liveChannel(projectId: string): string {
  return `live:${projectId}`;
}

/**
 * Bust the ingest action-manifest cache for a project so live/draft/delete
 * changes take effect immediately instead of after the 30s TTL (Audit N1).
 */
export async function clearManifestCache(projectId: string): Promise<void> {
  try {
    await redis().del(`manifest:${projectId}`);
  } catch {
    /* best-effort — TTL is the backstop */
  }
}
