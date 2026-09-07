import {
  type ActionDefinition,
  type ActionManifestEntry,
  actionDefinitionSchema,
  isInSchedule,
} from "@tracki/shared";
import { REDIS_KEYS } from "./config.js";
import { liveActionsForProject } from "./pg.js";
import { redis } from "./redis.js";

const MANIFEST_TTL_SEC = 30;

/**
 * Build the client-facing action manifest for a project: live, in-schedule
 * actions only, validated, with no internal fields. Cached in Redis ~30s.
 */
export async function getManifest(projectId: string): Promise<ActionManifestEntry[]> {
  const cacheKey = REDIS_KEYS.actionManifest(projectId);
  const cached = await redis().get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as ActionManifestEntry[];
    } catch {
      /* rebuild */
    }
  }

  const rows = await liveActionsForProject(projectId);
  const now = Date.now();
  const manifest: ActionManifestEntry[] = [];
  for (const row of rows) {
    const parsed = actionDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) continue;
    const def: ActionDefinition = parsed.data;
    // implementation: struggle-trigger (Live Assist) actions are server-driven — never
    // in the client manifest.
    if (def.trigger.kind === "struggle") continue;
    if (!isInSchedule(def.schedule, now)) continue;
    // Strip the server-only schedule from what the client receives.
    const { schedule: _schedule, ...clientDef } = def;
    manifest.push({ id: row.id, ...clientDef });
  }

  await redis().set(cacheKey, JSON.stringify(manifest), "EX", MANIFEST_TTL_SEC);
  return manifest;
}
