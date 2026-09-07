import { HIGH_INTENT_PATTERN, MONEY_STRUGGLE_TYPES } from "@tracki/shared";
import type { ClickHouseClient } from "./client";

/**
 * Mobile Journey Intelligence (slice 14) — screen heatmaps, per-session journey
 * rollups and revenue dimension cuts. All reads are tenancy-scoped and fully
 * parameterized. Events live in a ReplacingMergeTree, so event counts always go
 * through uniqExact(event_id)-style aggregates (audit slice-2 B1).
 *
 * Platform semantics: '' = pre-slice-14 rows (web), 'web' = browser snippet,
 * 'ios'/'android' = mobile SDKs. "Mobile" filters use IN ('ios','android').
 */

const MOBILE_PLATFORMS = ["ios", "android"];

// Same conversion predicate as revenue.ts (slice 13).
const conversionPredicate =
  "( type = 'action_goal' OR (type = 'track' AND JSONExtractString(props, 'name') = {conv:String}) )";

// A revenue-struggling session = struggle on a high-intent path OR a struggle
// type that is money-blocking wherever it happens (single-sourced from shared).
const revenueStrugglePredicate =
  "( match(lower(path), {hp:String}) OR type IN ({moneyTypes:Array(String)}) )";

export interface FrictionScreenRow {
  path: string;
  count: string;
  friction: string;
  top_type: string;
}

/** Screens ranked by SUMMED friction score — heatmap #1. Mobile platforms only. */
export async function frictionScreens(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  limit = 8,
): Promise<FrictionScreenRow[]> {
  const rs = await client.query({
    query: `
      SELECT path, toString(count()) AS count, toString(sum(score)) AS friction,
             topK(1)(type)[1] AS top_type
      FROM struggles
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
        AND platform IN ({mobile:Array(String)})
      GROUP BY path
      ORDER BY sum(score) DESC, path
      LIMIT {limit:UInt32}`,
    query_params: { orgId, projectId, days, limit, mobile: MOBILE_PLATFORMS },
    format: "JSONEachRow",
  });
  return rs.json<FrictionScreenRow>();
}

export interface AbandonmentScreenRow {
  path: string;
  /** Non-converted sessions whose LAST screen was this one. */
  ended: string;
  /** flow_abandon events recorded on this screen. */
  abandons: string;
}

/**
 * Heatmap #2 — where journeys die: the last screen of sessions that never
 * converted, alongside explicit flow_abandon counts per screen.
 */
export async function abandonmentScreens(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  conversionEvent = "purchase",
  limit = 8,
): Promise<AbandonmentScreenRow[]> {
  const rs = await client.query({
    query: `
      SELECT l.last_path AS path,
             toString(uniqExact(l.session_id)) AS ended,
             toString(any(a.abandons)) AS abandons
      FROM (
        SELECT session_id, argMax(path, ts) AS last_path
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY
          AND type = 'screen_view' AND platform IN ({mobile:Array(String)})
        GROUP BY session_id
      ) AS l
      LEFT JOIN (
        SELECT DISTINCT session_id, toUInt8(1) AS conv
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY AND ${conversionPredicate}
      ) AS c ON c.session_id = l.session_id
      LEFT JOIN (
        SELECT path AS apath, uniqExact(event_id) AS abandons
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY
          AND type = 'flow_abandon' AND platform IN ({mobile:Array(String)})
        GROUP BY apath
      ) AS a ON a.apath = l.last_path
      WHERE c.conv = 0
      GROUP BY l.last_path
      ORDER BY uniqExact(l.session_id) DESC, l.last_path
      LIMIT {limit:UInt32}`,
    query_params: {
      orgId,
      projectId,
      days,
      limit,
      conv: conversionEvent,
      mobile: MOBILE_PLATFORMS,
    },
    format: "JSONEachRow",
  });
  return rs.json<AbandonmentScreenRow>();
}

/**
 * Raw per-session journey signals. The 0–100 journey score itself is computed
 * in JS by the shared pure `journeyScore` so the formula has ONE home.
 */
export interface SessionJourneyRow {
  session_id: string;
  visitor: string;
  anon_id: string;
  started: string;
  ended: string;
  screens: string;
  events: string;
  completed_flows: string;
  abandoned_flows: string;
  converted: string; // '0' | '1'
  plat: string;
  app_ver: string;
  friction: string;
  struggle_count: string;
}

const sessionJourneySelect = `
  SELECT e.session_id AS session_id,
         argMax(if(e.user_id != '', e.user_id, e.anon_id), e.ts) AS visitor,
         argMax(e.anon_id, e.ts) AS anon_id,
         toString(min(e.ts)) AS started,
         toString(max(e.ts)) AS ended,
         toString(uniqExactIf(e.event_id, e.type = 'screen_view')) AS screens,
         toString(uniqExact(e.event_id)) AS events,
         toString(uniqExactIf(e.event_id, e.type = 'flow_complete')) AS completed_flows,
         toString(uniqExactIf(e.event_id, e.type = 'flow_abandon')) AS abandoned_flows,
         toString(max(if(e.type = 'action_goal'
                         OR (e.type = 'track' AND JSONExtractString(e.props, 'name') = {conv:String}),
                         1, 0))) AS converted,
         topK(1)(e.platform)[1] AS plat,
         topK(1)(e.app_version)[1] AS app_ver,
         toString(any(st.friction)) AS friction,
         toString(any(st.struggle_count)) AS struggle_count
  FROM events AS e
  LEFT JOIN (
    SELECT session_id AS ssid, sum(score) AS friction, count() AS struggle_count
    FROM struggles
    WHERE org_id = {orgId:String} AND project_id = {projectId:String}
      AND ts >= now() - INTERVAL {days:UInt32} DAY
    GROUP BY ssid
  ) AS st ON st.ssid = e.session_id
  WHERE e.org_id = {orgId:String} AND e.project_id = {projectId:String}
    AND e.ts >= now() - INTERVAL {days:UInt32} DAY`;

/** Recent mobile sessions with their journey signals (mobile page). */
export async function sessionJourneys(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  conversionEvent = "purchase",
  limit = 20,
): Promise<SessionJourneyRow[]> {
  const rs = await client.query({
    query: `${sessionJourneySelect}
        AND e.platform IN ({mobile:Array(String)})
      GROUP BY e.session_id
      ORDER BY max(e.ts) DESC
      LIMIT {limit:UInt32}`,
    query_params: {
      orgId,
      projectId,
      days,
      limit,
      conv: conversionEvent,
      mobile: MOBILE_PLATFORMS,
    },
    format: "JSONEachRow",
  });
  return rs.json<SessionJourneyRow>();
}

/** Journey signals for ONE visitor's sessions (timeline session grouping). */
export async function visitorSessions(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  anonIds: string[],
  userId: string | null,
  conversionEvent = "purchase",
  days = 90,
  limit = 30,
): Promise<SessionJourneyRow[]> {
  const rs = await client.query({
    query: `${sessionJourneySelect}
        AND (has({anonIds:Array(String)}, e.anon_id)
             OR ({userId:String} != '' AND e.user_id = {userId:String}))
      GROUP BY e.session_id
      ORDER BY max(e.ts) DESC
      LIMIT {limit:UInt32}`,
    query_params: {
      orgId,
      projectId,
      days,
      limit,
      conv: conversionEvent,
      anonIds,
      userId: userId ?? "",
    },
    format: "JSONEachRow",
  });
  return rs.json<SessionJourneyRow>();
}

export interface StruggleRecoveryRow {
  struggle_type: string;
  struggling: string;
  recovered: string;
  at_risk: string;
}

/**
 * Revenue recovery cut by struggle type — sessionized like slice-13:
 * recovered = struggled → saw an action impression → converted (correlation,
 * labeled as such in the UI); at_risk = struggled, never converted.
 */
export async function recoveryByStruggleType(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  conversionEvent = "purchase",
  limit = 12,
): Promise<StruggleRecoveryRow[]> {
  const rs = await client.query({
    query: `
      SELECT s.stype AS struggle_type,
             toString(uniqExact(s.session_id)) AS struggling,
             toString(uniqExactIf(s.session_id, i.imp = 1 AND c.conv = 1)) AS recovered,
             toString(uniqExactIf(s.session_id, c.conv = 0)) AS at_risk
      FROM (
        SELECT DISTINCT session_id, type AS stype
        FROM struggles
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY
          AND ${revenueStrugglePredicate}
      ) AS s
      LEFT JOIN (
        SELECT DISTINCT session_id, toUInt8(1) AS conv
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY AND ${conversionPredicate}
      ) AS c ON c.session_id = s.session_id
      LEFT JOIN (
        SELECT DISTINCT session_id, toUInt8(1) AS imp
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY AND type = 'action_impression'
      ) AS i ON i.session_id = s.session_id
      GROUP BY s.stype
      ORDER BY uniqExactIf(s.session_id, c.conv = 0) DESC, s.stype
      LIMIT {limit:UInt32}`,
    query_params: {
      orgId,
      projectId,
      days,
      limit,
      conv: conversionEvent,
      hp: HIGH_INTENT_PATTERN,
      moneyTypes: [...MONEY_STRUGGLE_TYPES],
    },
    format: "JSONEachRow",
  });
  return rs.json<StruggleRecoveryRow>();
}

export type RevenueDimension = "platform" | "app_version";

export interface DimensionRecoveryRow {
  dim: string;
  struggling: string;
  recovered: string;
  at_risk: string;
}

/**
 * Revenue recovery cut by a device dimension. `dimension` is a closed union —
 * mapped to a hardcoded column name here, NEVER interpolated from user input.
 */
export async function revenueByDimension(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  dimension: RevenueDimension,
  days = 30,
  conversionEvent = "purchase",
  limit = 10,
): Promise<DimensionRecoveryRow[]> {
  const col = dimension === "platform" ? "platform" : "app_version";
  const rs = await client.query({
    query: `
      SELECT s.dim AS dim,
             toString(uniqExact(s.session_id)) AS struggling,
             toString(uniqExactIf(s.session_id, i.imp = 1 AND c.conv = 1)) AS recovered,
             toString(uniqExactIf(s.session_id, c.conv = 0)) AS at_risk
      FROM (
        SELECT DISTINCT session_id, ${col} AS dim
        FROM struggles
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY
          AND ${revenueStrugglePredicate}
      ) AS s
      LEFT JOIN (
        SELECT DISTINCT session_id, toUInt8(1) AS conv
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY AND ${conversionPredicate}
      ) AS c ON c.session_id = s.session_id
      LEFT JOIN (
        SELECT DISTINCT session_id, toUInt8(1) AS imp
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY AND type = 'action_impression'
      ) AS i ON i.session_id = s.session_id
      GROUP BY s.dim
      ORDER BY uniqExactIf(s.session_id, c.conv = 0) DESC, s.dim
      LIMIT {limit:UInt32}`,
    query_params: {
      orgId,
      projectId,
      days,
      limit,
      conv: conversionEvent,
      hp: HIGH_INTENT_PATTERN,
      moneyTypes: [...MONEY_STRUGGLE_TYPES],
    },
    format: "JSONEachRow",
  });
  return rs.json<DimensionRecoveryRow>();
}
