import { BEHAVIORAL_EVENT_TYPES, type StoredEvent } from "@tracki/shared";
import type { ClickHouseClient } from "./client";

function toCHDateTime(ms: number): string {
  // ClickHouse DateTime64(3) accepts 'YYYY-MM-DD HH:MM:SS.mmm' in UTC.
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

export async function insertEvents(client: ClickHouseClient, events: StoredEvent[]): Promise<void> {
  if (events.length === 0) return;
  await client.insert({
    table: "events",
    format: "JSONEachRow",
    values: events.map((e) => ({
      ...e,
      ts: toCHDateTime(e.ts),
      received_at: toCHDateTime(e.received_at),
    })),
  });
}

export interface LiveEventRow {
  event_id: string;
  type: string;
  path: string;
  anon_id: string;
  user_id: string;
  session_id: string;
  ts: string;
}

/** Recent events for a project (timeline / backfill before SSE takes over). */
export async function recentEvents(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  limit = 50,
): Promise<LiveEventRow[]> {
  const rs = await client.query({
    query: `
      SELECT event_id, type, path, anon_id, user_id, session_id, toString(ts) AS ts
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
      ORDER BY ts DESC
      LIMIT 1 BY event_id
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, limit },
    format: "JSONEachRow",
  });
  return rs.json<LiveEventRow>();
}

/**
 * Distinct recent paths/screens for ONE session (newest first) — a cheap,
 * tenancy- + session-scoped behavioral signal for contextual FAQ grounding
 * (slice 5 "ground on recent events", not just the current page).
 */
export async function recentSessionPaths(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  sessionId: string,
  limit = 5,
): Promise<string[]> {
  const rs = await client.query({
    query: `
      SELECT path, max(ts) AS last
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND session_id = {sessionId:String} AND path != ''
      GROUP BY path
      ORDER BY last DESC
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, sessionId, limit },
    format: "JSONEachRow",
  });
  return (await rs.json<{ path: string }>()).map((r) => r.path);
}

/** Timeline rows carry props + device context for mobile journey rendering (slice 14). */
export interface TimelineEventRow extends LiveEventRow {
  props: string;
  platform: string;
  app_version: string;
}

/**
 * Events for one visitor — by their anon_id plus any anon_ids mapped to the
 * same identified user (identity merge; mapping comes from Postgres).
 */
export async function visitorTimeline(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  anonIds: string[],
  userId: string | null,
  limit = 200,
): Promise<TimelineEventRow[]> {
  const rs = await client.query({
    query: `
      SELECT event_id, type, path, anon_id, user_id, session_id, props, platform,
             app_version, toString(ts) AS ts
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND (has({anonIds:Array(String)}, anon_id)
             OR ({userId:String} != '' AND user_id = {userId:String}))
      ORDER BY ts ASC
      LIMIT 1 BY event_id
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, anonIds, userId: userId ?? "", limit },
    format: "JSONEachRow",
  });
  return rs.json<TimelineEventRow>();
}

export interface VolumeRow {
  day: string;
  type: string;
  count: string;
}

/** Per-day, per-type event counts for the last N days. */
export async function dailyVolume(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
): Promise<VolumeRow[]> {
  const rs = await client.query({
    query: `
      SELECT toDate(ts) AS day, type, toString(uniqExact(event_id)) AS count
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
        AND type IN ({behavioral:Array(String)})
      GROUP BY day, type
      ORDER BY day ASC`,
    query_params: { orgId, projectId, days, behavioral: [...BEHAVIORAL_EVENT_TYPES] },
    format: "JSONEachRow",
  });
  return rs.json<VolumeRow>();
}
