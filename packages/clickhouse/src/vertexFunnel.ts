import type { ClickHouseClient } from "./client";

/**
 * Vertex activation funnel + drop-off cohorts.
 *
 * Everything reads from `track` events whose `props.name` is a Vertex event,
 * grouped per VISITOR — the identified `user_id` when present, else `anon_id`,
 * so a merchant who logged in isn't double-counted across their pre/post-login
 * sessions. Tenancy-scoped. CH gotchas respected: no alias shadows a real
 * column used in an aggregate; the time window mirrors the revenue module's
 * `ts` comparison exactly.
 */

// Collapse identified sessions onto the user; fall back to the anon visitor.
const VISITOR = "if(user_id != '', user_id, anon_id)";
const NAME = "JSONExtractString(props, 'name')";
const TRACK_WINDOW =
  "org_id = {orgId:String} AND project_id = {projectId:String} AND type = 'track' AND ts >= now() - INTERVAL {days:UInt32} DAY";

/** Distinct visitors that reached each funnel stage, in journey order. */
export interface VertexFunnelRow {
  landing: string;
  booking_started: string;
  booking_completed: string;
  signup: string;
  platform_selected: string;
  oauth_started: string;
  oauth_failed: string;
  store_connected: string;
  first_sync: string;
  first_report: string;
  subscription: string;
}

function emptyFunnel(): VertexFunnelRow {
  return {
    landing: "0",
    booking_started: "0",
    booking_completed: "0",
    signup: "0",
    platform_selected: "0",
    oauth_started: "0",
    oauth_failed: "0",
    store_connected: "0",
    first_sync: "0",
    first_report: "0",
    subscription: "0",
  };
}

export async function vertexFunnel(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
): Promise<VertexFunnelRow> {
  const rs = await client.query({
    query: `
      SELECT
        toString(uniqExactIf(visitor, name = 'landing_viewed'))              AS landing,
        toString(uniqExactIf(visitor, name = 'booking_started'))             AS booking_started,
        toString(uniqExactIf(visitor, name = 'booking_completed'))           AS booking_completed,
        toString(uniqExactIf(visitor, name = 'signup_completed'))            AS signup,
        toString(uniqExactIf(visitor, name = 'platform_selected'))           AS platform_selected,
        toString(uniqExactIf(visitor, name = 'oauth_started'))               AS oauth_started,
        toString(uniqExactIf(visitor, name = 'oauth_failed'))                AS oauth_failed,
        toString(uniqExactIf(visitor, name = 'store_connected'))             AS store_connected,
        toString(uniqExactIf(visitor, name = 'first_sync_completed'))        AS first_sync,
        toString(uniqExactIf(visitor, name = 'first_profit_report_viewed'))  AS first_report,
        toString(uniqExactIf(visitor, name = 'subscription_started'))        AS subscription
      FROM (
        SELECT ${VISITOR} AS visitor, ${NAME} AS name
        FROM events
        WHERE ${TRACK_WINDOW}
      )`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return (await rs.json<VertexFunnelRow>())[0] ?? emptyFunnel();
}

/**
 * Drop-off cohorts — visitors who reached stage A but not stage B. These are the
 * actionable lists an operator wants: who to nudge and where the funnel leaks.
 */
export interface VertexCohortsRow {
  /** booking_started, never booking_completed. */
  booking_abandoned: string;
  /** hit an oauth_failed and never reached store_connected. */
  oauth_failures: string;
  /** signed up / booked but never connected a store (proxy for "trial without store"). */
  converted_no_store: string;
  /** store_connected but never saw a first profit report. */
  connected_no_report: string;
  /** saw a first profit report (activated) but never started a subscription. */
  activated_not_subscribed: string;
}

function emptyCohorts(): VertexCohortsRow {
  return {
    booking_abandoned: "0",
    oauth_failures: "0",
    converted_no_store: "0",
    connected_no_report: "0",
    activated_not_subscribed: "0",
  };
}

export async function vertexCohorts(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 30,
): Promise<VertexCohortsRow> {
  const rs = await client.query({
    query: `
      SELECT
        toString(countIf(has_booking = 1 AND has_booking_done = 0)) AS booking_abandoned,
        toString(countIf(has_oauth_fail = 1 AND has_connected = 0)) AS oauth_failures,
        toString(countIf((has_signup = 1 OR has_booking_done = 1) AND has_connected = 0)) AS converted_no_store,
        toString(countIf(has_connected = 1 AND has_report = 0)) AS connected_no_report,
        toString(countIf(has_report = 1 AND has_sub = 0)) AS activated_not_subscribed
      FROM (
        SELECT
          visitor,
          maxIf(toUInt8(1), name = 'booking_started')              AS has_booking,
          maxIf(toUInt8(1), name = 'booking_completed')            AS has_booking_done,
          maxIf(toUInt8(1), name = 'signup_completed')             AS has_signup,
          maxIf(toUInt8(1), name = 'oauth_failed')                 AS has_oauth_fail,
          maxIf(toUInt8(1), name = 'store_connected')              AS has_connected,
          maxIf(toUInt8(1), name = 'first_profit_report_viewed')   AS has_report,
          maxIf(toUInt8(1), name = 'subscription_started')         AS has_sub
        FROM (
          SELECT ${VISITOR} AS visitor, ${NAME} AS name
          FROM events
          WHERE ${TRACK_WINDOW}
        )
        GROUP BY visitor
      )`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  return (await rs.json<VertexCohortsRow>())[0] ?? emptyCohorts();
}
