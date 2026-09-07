import { type ClickHouseClient, visitorInSegment } from "@tracki/clickhouse";
import {
  type ActionDefinition,
  type AssistPayload,
  type StruggleDetection,
  actionDefinitionSchema,
  segmentDefinitionSchema,
} from "@tracki/shared";
import { REDIS_KEYS } from "./config.js";
import { matchForContext } from "./matcher.js";
import { getSegmentDefinition, liveStruggleActionsForProject } from "./pg.js";
import { redis } from "./redis.js";

const STRUGGLE_ACTIONS_TTL_SEC = 30;
const ASSIST_TTL_SEC = 90;
const ASSIST_CAP_TTL_SEC = 30 * 60; // once per session per action (~30 min)

interface CachedAction {
  id: string;
  def: ActionDefinition;
}

/** Live struggle-trigger actions for a project, validated + Redis-cached ~30s. */
async function struggleActions(projectId: string): Promise<CachedAction[]> {
  const cacheKey = REDIS_KEYS.struggleActions(projectId);
  const cached = await redis().get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as CachedAction[];
    } catch {
      /* rebuild */
    }
  }
  const rows = await liveStruggleActionsForProject(projectId);
  const out: CachedAction[] = [];
  for (const row of rows) {
    const parsed = actionDefinitionSchema.safeParse(row.definition);
    if (parsed.success) out.push({ id: row.id, def: parsed.data });
  }
  await redis().set(cacheKey, JSON.stringify(out), "EX", STRUGGLE_ACTIONS_TTL_SEC);
  return out;
}

async function matchesSegment(
  ch: ClickHouseClient,
  orgId: string,
  projectId: string,
  segmentId: string,
  anonId: string,
): Promise<boolean> {
  const rawDef = await getSegmentDefinition(segmentId, projectId);
  if (!rawDef) return false;
  const parsed = segmentDefinitionSchema.safeParse(rawDef);
  if (!parsed.success) return false;
  // Audit M2: single-visitor point lookup, not a full-set computation.
  return visitorInSegment(ch, orgId, projectId, parsed.data, anonId);
}

/**
 * On a detected struggle, find a live Live-Assist action that targets this
 * context (urlContains + struggleTypes + segment), match a grounded FAQ, and
 * stash a pending assist for the session. Returned to the snippet on its next
 * /v1/events flush. Off the ack path; failures are swallowed.
 */
export async function computeAssist(ch: ClickHouseClient, s: StruggleDetection): Promise<void> {
  const actions = await struggleActions(s.project_id);
  if (actions.length === 0) return;

  for (const { id, def } of actions) {
    if (def.urlContains && !s.path.includes(def.urlContains)) continue;
    if (def.struggleTypes && def.struggleTypes.length > 0 && !def.struggleTypes.includes(s.type)) {
      continue;
    }
    if (def.segmentId) {
      const ok = await matchesSegment(ch, s.org_id, s.project_id, def.segmentId, s.anon_id);
      if (!ok) continue;
    }

    // Audit M4: server-side cap — show a given Live Assist at most once per
    // session (snippet dedupes per page-load only). SET NX is the gate.
    const capKey = `assistcap:${s.project_id}:${s.session_id}:${id}`;
    const fresh = await redis().set(capKey, "1", "EX", ASSIST_CAP_TTL_SEC, "NX");
    if (fresh !== "OK") return;

    const match = await matchForContext(
      s.project_id,
      {
        path: s.path,
        struggleType: s.type,
        element: s.element,
        orgId: s.org_id,
        sessionId: s.session_id,
      },
      ch,
    );
    const payload: AssistPayload = {
      actionId: id,
      mode: match.mode,
      confidence: match.confidence,
      content: def.content,
      ...(match.mode === "answer" ? { article: match.article, articleId: match.articleId } : {}),
    };
    await redis().set(
      REDIS_KEYS.assist(s.project_id, s.session_id),
      JSON.stringify(payload),
      "EX",
      ASSIST_TTL_SEC,
    );
    return; // first matching action wins
  }
}

/** Pop (read-and-clear) a pending assist for a session. Atomic via GETDEL (Audit N1). */
export async function popAssist(
  projectId: string,
  sessionId: string,
): Promise<AssistPayload | null> {
  const key = REDIS_KEYS.assist(projectId, sessionId);
  const raw = await redis().getdel(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AssistPayload;
  } catch {
    return null;
  }
}
