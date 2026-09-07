import type { SegmentDefinition, StruggleDetection } from "@tracki/shared";
import type { ClickHouseClient } from "./client";

function toCHDateTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

export async function insertStruggles(
  client: ClickHouseClient,
  struggles: StruggleDetection[],
): Promise<void> {
  if (struggles.length === 0) return;
  await client.insert({
    table: "struggles",
    format: "JSONEachRow",
    values: struggles.map((s) => ({ ...s, ts: toCHDateTime(s.ts) })),
  });
}

export interface StruggleRow {
  struggle_id: string;
  type: string;
  severity: string;
  path: string;
  element: string;
  reason: string;
  anon_id: string;
  user_id: string;
  session_id: string;
  event_count: number;
  score: number;
  ts: string;
}

export async function recentStruggles(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  limit = 50,
): Promise<StruggleRow[]> {
  const rs = await client.query({
    query: `
      SELECT struggle_id, type, severity, path, element, reason, anon_id, user_id,
             session_id, event_count, score, toString(ts) AS ts
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
      ORDER BY ts DESC
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, limit },
    format: "JSONEachRow",
  });
  return rs.json<StruggleRow>();
}

export interface StruggleVolumeRow {
  day: string;
  type: string;
  count: string;
}

export async function dailyStruggleReport(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
): Promise<StruggleVolumeRow[]> {
  const rs = await client.query({
    query: `
      SELECT toDate(ts) AS day, type, toString(count()) AS count
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY day, type
      ORDER BY day ASC`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return rs.json<StruggleVolumeRow>();
}

export interface PathCountRow {
  path: string;
  count: string;
}

export async function struggleCountsByPath(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
  limit = 10,
): Promise<PathCountRow[]> {
  const rs = await client.query({
    query: `
      SELECT path, toString(count()) AS count
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY path
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, days, limit },
    format: "JSONEachRow",
  });
  return rs.json<PathCountRow>();
}

// ── Rich struggle reporting (implementation) ────────────────────────────────────

export interface SeverityCountRow {
  severity: string;
  count: string;
}

/** High/medium/low totals over the window — drives the severity summary band. */
export async function struggleSeverityCounts(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
): Promise<SeverityCountRow[]> {
  const rs = await client.query({
    query: `
      SELECT severity, toString(count()) AS count
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY severity`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return rs.json<SeverityCountRow>();
}

export interface FrictionPathRow {
  path: string;
  count: string;
  friction: string;
}

/** Paths ranked by SUMMED friction score (pain), not raw count. The aggregate
 *  alias must NOT be `score` — that would shadow the column inside `sum()`. */
export async function frictionByPath(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
  limit = 8,
): Promise<FrictionPathRow[]> {
  const rs = await client.query({
    query: `
      SELECT path, toString(count()) AS count, toString(sum(score)) AS friction
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY path
      ORDER BY sum(score) DESC
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, days, limit },
    format: "JSONEachRow",
  });
  return rs.json<FrictionPathRow>();
}

export interface FrictionSeedRow {
  path: string;
  top_type: string;
  top_element: string;
  /** Dominant platform ('' legacy/web, 'web', 'ios', 'android') — audit 00-14 M2. */
  top_platform: string;
  count: string;
  friction: string;
}

/**
 * implementation — Autopilot seeds: per path, the DOMINANT struggle type + element
 * alongside count and summed friction, in one pass. Distinct aliases (top_type,
 * top_element, friction) avoid shadowing the real columns inside aggregates.
 */
export async function frictionSeeds(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  limit = 12,
): Promise<FrictionSeedRow[]> {
  const rs = await client.query({
    query: `
      SELECT
        path,
        topK(1)(type)[1] AS top_type,
        topKIf(1)(element, element != '')[1] AS top_element,
        topK(1)(platform)[1] AS top_platform,
        toString(count()) AS count,
        toString(sum(score)) AS friction
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY path
      ORDER BY sum(score) DESC, path
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, days, limit },
    format: "JSONEachRow",
  });
  return rs.json<FrictionSeedRow>();
}

export interface ElementCountRow {
  element: string;
  top_type: string;
  count: string;
}

/** The elements causing the most struggles (skips struggles with no element).
 *  `top_type` is the element's DOMINANT (most frequent) struggle type, not an
 *  arbitrary member — and the alias avoids shadowing the `type` column. */
export async function topStruggleElements(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
  limit = 8,
): Promise<ElementCountRow[]> {
  const rs = await client.query({
    query: `
      SELECT element, topK(1)(type)[1] AS top_type, toString(count()) AS count
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY AND element != ''
      GROUP BY element
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, days, limit },
    format: "JSONEachRow",
  });
  return rs.json<ElementCountRow>();
}

export interface VisitorStruggleRow {
  visitor: string;
  count: string;
  max_score: string;
}

/** Most-struggling visitors (user_id when known, else anon_id). */
export async function topStruggleVisitors(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
  limit = 8,
): Promise<VisitorStruggleRow[]> {
  const rs = await client.query({
    query: `
      SELECT if(user_id != '', user_id, anon_id) AS visitor,
             toString(count()) AS count, toString(max(score)) AS max_score
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY visitor
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, days, limit },
    format: "JSONEachRow",
  });
  return rs.json<VisitorStruggleRow>();
}

/**
 * Evaluate a segment to the set of distinct visitor anon_ids matching ALL
 * conditions, bounded to the last `days`. Each condition runs as its own
 * fully-parameterized query (no SQL string-building from user input); the
 * resulting sets are intersected in JS.
 */
export async function segmentVisitorIds(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  def: SegmentDefinition,
  days = 30,
): Promise<Set<string>> {
  const base = { orgId, projectId, days };

  async function idsFrom(query: string, params: Record<string, unknown>): Promise<Set<string>> {
    const rs = await client.query({
      query,
      query_params: { ...base, ...params },
      format: "JSONEachRow",
    });
    const rows = await rs.json<{ anon_id: string }>();
    return new Set(rows.map((r) => r.anon_id));
  }

  const sets: Set<string>[] = [];
  for (const c of def.conditions) {
    if (c.kind === "struggle") {
      sets.push(
        await idsFrom(
          `SELECT DISTINCT anon_id FROM struggles
           WHERE org_id={orgId:String} AND project_id={projectId:String}
             AND type={t:String} AND ts >= now() - INTERVAL {days:UInt32} DAY`,
          { t: c.struggleType },
        ),
      );
    } else if (c.kind === "event") {
      const pathClause = c.pathContains ? "AND position(path, {needle:String}) > 0" : "";
      sets.push(
        await idsFrom(
          `SELECT DISTINCT anon_id FROM events
           WHERE org_id={orgId:String} AND project_id={projectId:String}
             AND type={t:String} ${pathClause}
             AND ts >= now() - INTERVAL {days:UInt32} DAY`,
          c.pathContains ? { t: c.eventType, needle: c.pathContains } : { t: c.eventType },
        ),
      );
    } else {
      // identified: visitors with (value=true) or without (value=false) a user_id.
      const identified = await idsFrom(
        `SELECT DISTINCT anon_id FROM events
         WHERE org_id={orgId:String} AND project_id={projectId:String}
           AND user_id != '' AND ts >= now() - INTERVAL {days:UInt32} DAY`,
        {},
      );
      if (c.value) {
        sets.push(identified);
      } else {
        const all = await idsFrom(
          `SELECT DISTINCT anon_id FROM events
           WHERE org_id={orgId:String} AND project_id={projectId:String}
             AND ts >= now() - INTERVAL {days:UInt32} DAY`,
          {},
        );
        for (const id of identified) all.delete(id);
        sets.push(all);
      }
    }
  }

  if (sets.length === 0) return new Set();
  // Intersect, smallest set first.
  sets.sort((a, b) => a.size - b.size);
  const [first, ...rest] = sets;
  const result = new Set(first);
  for (const id of result) {
    if (rest.some((s) => !s.has(id))) result.delete(id);
  }
  return result;
}

/** The most recent struggle type for a session (handoff context). */
export async function latestStruggleType(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  sessionId: string,
): Promise<string | null> {
  const rs = await client.query({
    query: `SELECT type FROM struggles
      WHERE org_id={orgId:String} AND project_id={projectId:String} AND session_id={sessionId:String}
      ORDER BY ts DESC LIMIT 1`,
    query_params: { orgId, projectId, sessionId },
    format: "JSONEachRow",
  });
  return (await rs.json<{ type: string }>())[0]?.type ?? null;
}

/**
 * Single-visitor segment membership — a point lookup (each condition checked
 * with `AND anon_id = {anonId}`), so it does NOT compute the whole segment set.
 * Used in the worker per struggle (Audit M2) where computing the full set would
 * hammer ClickHouse under a struggle storm.
 */
export async function visitorInSegment(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  def: SegmentDefinition,
  anonId: string,
  days = 30,
): Promise<boolean> {
  const base = { orgId, projectId, anonId, days };

  async function exists(query: string, params: Record<string, unknown>): Promise<boolean> {
    const rs = await client.query({
      query,
      query_params: { ...base, ...params },
      format: "JSONEachRow",
    });
    return (await rs.json<{ n: string }>())[0]?.n !== "0";
  }

  // ALL conditions must hold for this anon_id.
  for (const c of def.conditions) {
    let ok: boolean;
    if (c.kind === "struggle") {
      ok = await exists(
        `SELECT toString(count()) AS n FROM struggles
         WHERE org_id={orgId:String} AND project_id={projectId:String} AND anon_id={anonId:String}
           AND type={t:String} AND ts >= now() - INTERVAL {days:UInt32} DAY`,
        { t: c.struggleType },
      );
    } else if (c.kind === "event") {
      const pathClause = c.pathContains ? "AND position(path, {needle:String}) > 0" : "";
      ok = await exists(
        `SELECT toString(count()) AS n FROM events
         WHERE org_id={orgId:String} AND project_id={projectId:String} AND anon_id={anonId:String}
           AND type={t:String} ${pathClause} AND ts >= now() - INTERVAL {days:UInt32} DAY`,
        c.pathContains ? { t: c.eventType, needle: c.pathContains } : { t: c.eventType },
      );
    } else {
      // identified: does this anon_id have any event with a user_id?
      const has = await exists(
        `SELECT toString(count()) AS n FROM events
         WHERE org_id={orgId:String} AND project_id={projectId:String} AND anon_id={anonId:String}
           AND user_id != '' AND ts >= now() - INTERVAL {days:UInt32} DAY`,
        {},
      );
      ok = c.value ? has : !has;
    }
    if (!ok) return false;
  }
  return true;
}
