import { REDIS_KEYS, config } from "./config.js";
import { type ProjectRef, lookupProjectByKey } from "./pg.js";
import { redis } from "./redis.js";

const NEGATIVE = "none";

/**
 * Resolve pk_… → project/org with a 60s Redis cache. Unknown keys are cached
 * negatively too, so a flood of bad keys doesn't hammer Postgres.
 */
export async function resolveKey(key: string): Promise<ProjectRef | null> {
  const cacheKey = REDIS_KEYS.keyCache(key);
  const cached = await redis().get(cacheKey);
  if (cached === NEGATIVE) return null;
  if (cached) {
    const [projectId, orgId] = cached.split("|");
    if (projectId && orgId) return { projectId, orgId };
  }

  const ref = await lookupProjectByKey(key);
  // Audit N2: short negative TTL so a just-created project isn't dropped for a
  // full minute if a request raced ahead of the project row.
  await redis().set(
    cacheKey,
    ref ? `${ref.projectId}|${ref.orgId}` : NEGATIVE,
    "EX",
    ref ? config.keyCacheTtlSec : config.negativeKeyCacheTtlSec,
  );
  return ref;
}

/** Fixed-window rate limit per key. Returns true if the request is allowed. */
export async function allowRequest(key: string): Promise<boolean> {
  const windowSec = Math.floor(Date.now() / 1000);
  const rlKey = REDIS_KEYS.rateLimit(key, windowSec);
  const count = await redis().incr(rlKey);
  if (count === 1) await redis().expire(rlKey, 2);
  return count <= config.rateLimitPerSec;
}
