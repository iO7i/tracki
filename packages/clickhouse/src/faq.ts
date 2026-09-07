import type { ClickHouseClient } from "./client";

export interface FaqTotals {
  views: string;
  searches: string;
  noResults: string;
  votesUp: string;
  votesDown: string;
}

export interface TermRow {
  term: string;
  count: string;
}

export interface FaqReport {
  totals: FaqTotals;
  topSearches: TermRow[];
  topNoResults: TermRow[];
}

async function terms(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  type: string,
  days: number,
): Promise<TermRow[]> {
  const rs = await client.query({
    query: `
      SELECT JSONExtractString(props, 'query') AS term, toString(count()) AS count
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND type = {type:String}
        AND ts >= now() - INTERVAL {days:UInt32} DAY
        AND JSONExtractString(props, 'query') != ''
      GROUP BY term
      ORDER BY count() DESC
      LIMIT 15`,
    query_params: { orgId, projectId, type, days },
    format: "JSONEachRow",
  });
  return rs.json<TermRow>();
}

export async function faqReport(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days = 14,
): Promise<FaqReport> {
  const totalsRs = await client.query({
    query: `
      SELECT
        toString(countIf(type = 'faq_view')) AS views,
        toString(countIf(type = 'faq_search')) AS searches,
        toString(countIf(type = 'faq_search_noresult')) AS noResults,
        toString(countIf(type = 'faq_vote_up')) AS votesUp,
        toString(countIf(type = 'faq_vote_down')) AS votesDown
      FROM events
      WHERE org_id = {orgId:String} AND project_id = {projectId:String}
        AND type IN ('faq_view','faq_search','faq_search_noresult','faq_vote_up','faq_vote_down')
        AND ts >= now() - INTERVAL {days:UInt32} DAY`,
    query_params: { orgId, projectId, days },
    format: "JSONEachRow",
  });
  const totals = (await totalsRs.json<FaqTotals>())[0] ?? {
    views: "0",
    searches: "0",
    noResults: "0",
    votesUp: "0",
    votesDown: "0",
  };

  const [topSearches, topNoResults] = await Promise.all([
    terms(client, orgId, projectId, "faq_search", days),
    terms(client, orgId, projectId, "faq_search_noresult", days),
  ]);

  return { totals, topSearches, topNoResults };
}
