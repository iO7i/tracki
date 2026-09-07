import { HIGH_INTENT_PATTERN, MONEY_STRUGGLE_TYPES } from "@tracki/shared";
import type { ClickHouseClient } from "./client";

/**
 * Revenue Impact (implementation) — sessionized money queries. "High-intent" uses the
 * SAME pattern as the detector/Autopilot (single-sourced from @tracki/shared),
 * passed as a query parameter so RE2 sees the real `\b` word boundaries (a SQL
 * string literal would eat the backslash). All reads are tenancy-scoped.
 *
 * `conversion` = a session converted = it has an `action_goal` (action-attributed)
 * or a `track` event whose `props.name` equals the project's conversion event.
 */

const conversionPredicate =
  "( type = 'action_goal' OR (type = 'track' AND JSONExtractString(props, 'name') = {conv:String}) )";

// implementation: a struggle counts as revenue-struggling when it happened on a
// high-intent path OR its type is inherently money-blocking (e.g. a repeated
// payment failure on a mobile screen not named "checkout").
const revenueStrugglePredicate =
  "( match(lower(path), {hp:String}) OR type IN ({moneyTypes:Array(String)}) )";

export interface RevenueImpactRow {
  /** Distinct sessions that struggled on a high-intent path. */
  struggling: string;
  /** Of those, sessions that converted. */
  converted: string;
  /** Struggling sessions that saw an action impression and then converted. */
  recovered: string;
  /** Struggling sessions that did not convert. */
  at_risk: string;
}

export async function revenueImpact(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  conversionEvent = "purchase",
): Promise<RevenueImpactRow> {
  const rs = await client.query({
    query: `
      SELECT
        toString(count()) AS struggling,
        toString(countIf(conv = 1)) AS converted,
        toString(countIf(saw_imp = 1 AND conv = 1)) AS recovered,
        toString(countIf(conv = 0)) AS at_risk
      FROM (
        SELECT s.session_id AS session_id, max(c.conv) AS conv, max(i.imp) AS saw_imp
        FROM (
          SELECT DISTINCT session_id
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
        GROUP BY s.session_id
      )`,
    query_params: {
      orgId,
      projectId,
      days,
      hp: HIGH_INTENT_PATTERN,
      conv: conversionEvent,
      moneyTypes: [...MONEY_STRUGGLE_TYPES],
    },
    format: "JSONEachRow",
  });
  return (
    (await rs.json<RevenueImpactRow>())[0] ?? {
      struggling: "0",
      converted: "0",
      recovered: "0",
      at_risk: "0",
    }
  );
}

export interface RevenuePathRow {
  path: string;
  struggling: string;
  at_risk: string;
}

/** High-intent paths ranked by at-risk (unconverted struggling) sessions. */
export async function revenueByPath(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
  conversionEvent = "purchase",
  limit = 6,
): Promise<RevenuePathRow[]> {
  const rs = await client.query({
    query: `
      SELECT
        s.path AS path,
        toString(uniqExact(s.session_id)) AS struggling,
        toString(uniqExactIf(s.session_id, c.conv = 0)) AS at_risk
      FROM (
        SELECT DISTINCT session_id, path
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
      GROUP BY s.path
      ORDER BY uniqExactIf(s.session_id, c.conv = 0) DESC, s.path
      LIMIT {limit:UInt32}`,
    query_params: {
      orgId,
      projectId,
      days,
      hp: HIGH_INTENT_PATTERN,
      conv: conversionEvent,
      limit,
      moneyTypes: [...MONEY_STRUGGLE_TYPES],
    },
    format: "JSONEachRow",
  });
  return rs.json<RevenuePathRow>();
}
