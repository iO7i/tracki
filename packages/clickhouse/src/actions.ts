import type { ClickHouseClient } from "./client";

export interface ActionResultRow {
  action_id: string;
  variant: string;
  impressions: string;
  clicks: string;
  dismisses: string;
  goals: string;
}

/**
 * Per-action × variant funnel from the action_* tracking events. action_id and
 * variant live in the (PII-scrubbed) props JSON; extracted via JSONExtractString.
 * Fully parameterized.
 */
export interface AssistResultRow {
  action_id: string;
  shown: string;
  helpful: string;
  unhelpful: string;
  escalate: string;
}

/** Live Assist funnel per action from the assist_* tracking events. */
export async function assistResults(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
): Promise<AssistResultRow[]> {
  const rs = await client.query({
    query: `
      SELECT
        JSONExtractString(props, 'action_id') AS action_id,
        toString(uniqExactIf(event_id, type = 'assist_shown')) AS shown,
        toString(uniqExactIf(event_id, type = 'assist_helpful')) AS helpful,
        toString(uniqExactIf(event_id, type = 'assist_unhelpful')) AS unhelpful,
        toString(uniqExactIf(event_id, type = 'assist_escalate')) AS escalate
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND type IN ('assist_shown','assist_helpful','assist_unhelpful','assist_escalate')
        AND ts >= now() - INTERVAL {days:UInt32} DAY
        AND JSONExtractString(props, 'action_id') != ''
      GROUP BY action_id
      ORDER BY action_id`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return rs.json<AssistResultRow>();
}

export interface ActionOutcomeRow {
  action_id: string;
  struggled_sessions: string;
  recovered_sessions: string;
}

/**
 * implementation — Outcomes: per action, sessions that struggled BEFORE their first
 * impression of it, and how many of those *recovered* — no further struggle in
 * the session after the impression, or the action's goal fired. Correlation,
 * not causation (labeled as such in the UI). Sessionized via session_id across
 * the events and struggles tables; fully parameterized.
 */
export async function actionOutcomes(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
): Promise<ActionOutcomeRow[]> {
  const rs = await client.query({
    query: `
      SELECT
        imp.action_id AS action_id,
        toString(count()) AS struggled_sessions,
        toString(countIf(
          NOT arrayExists(t -> t > imp.first_imp, s.struggle_ts)
          -- Audit 12 N2: on a LEFT JOIN miss first_goal is NULL (verified live;
          -- with join_use_nulls=0 it could instead be the epoch-0 default) —
          -- either way the comparison is false, so a goal-less session can
          -- never count as recovered through this branch.
          OR g.first_goal > toDateTime64(0, 3)
        )) AS recovered_sessions
      FROM (
        SELECT JSONExtractString(props, 'action_id') AS action_id, session_id, min(ts) AS first_imp
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND type = 'action_impression'
          AND ts >= now() - INTERVAL {days:UInt32} DAY
          AND JSONExtractString(props, 'action_id') != ''
        GROUP BY action_id, session_id
      ) AS imp
      INNER JOIN (
        SELECT session_id, groupArray(ts) AS struggle_ts
        FROM struggles
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND ts >= now() - INTERVAL {days:UInt32} DAY
        GROUP BY session_id
      ) AS s ON s.session_id = imp.session_id
      LEFT JOIN (
        SELECT JSONExtractString(props, 'action_id') AS action_id, session_id, min(ts) AS first_goal
        FROM events
        WHERE org_id = {orgId:String} AND project_id = {projectId:String}
          AND type = 'action_goal'
          AND ts >= now() - INTERVAL {days:UInt32} DAY
          AND JSONExtractString(props, 'action_id') != ''
        GROUP BY action_id, session_id
      ) AS g ON g.action_id = imp.action_id AND g.session_id = imp.session_id
      WHERE arrayExists(t -> t <= imp.first_imp, s.struggle_ts)
      GROUP BY imp.action_id
      ORDER BY imp.action_id`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return rs.json<ActionOutcomeRow>();
}

export interface ActionChannelRow {
  action_id: string;
  channel: string;
  clicks: string;
}

/** implementation — clicks per action × channel (url/faq/chat/whatsapp; '' = pre-implementation clicks). */
export async function actionChannelClicks(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
): Promise<ActionChannelRow[]> {
  const rs = await client.query({
    query: `
      SELECT
        JSONExtractString(props, 'action_id') AS action_id,
        JSONExtractString(props, 'channel') AS channel,
        toString(uniqExact(event_id)) AS clicks
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND type = 'action_click'
        AND ts >= now() - INTERVAL {days:UInt32} DAY
        AND JSONExtractString(props, 'action_id') != ''
      GROUP BY action_id, channel
      ORDER BY action_id, channel`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return rs.json<ActionChannelRow>();
}

export async function actionResults(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
): Promise<ActionResultRow[]> {
  const rs = await client.query({
    query: `
      SELECT
        JSONExtractString(props, 'action_id') AS action_id,
        JSONExtractString(props, 'variant') AS variant,
        toString(uniqExactIf(event_id, type = 'action_impression')) AS impressions,
        toString(uniqExactIf(event_id, type = 'action_click')) AS clicks,
        toString(uniqExactIf(event_id, type = 'action_dismiss')) AS dismisses,
        toString(uniqExactIf(event_id, type = 'action_goal')) AS goals
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND type IN ('action_impression','action_click','action_dismiss','action_goal')
        AND ts >= now() - INTERVAL {days:UInt32} DAY
        AND JSONExtractString(props, 'action_id') != ''
      GROUP BY action_id, variant
      ORDER BY action_id, variant`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return rs.json<ActionResultRow>();
}
