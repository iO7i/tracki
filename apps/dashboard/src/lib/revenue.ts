import "server-only";
import { clickhouse } from "@/lib/analytics";
import { revenueByPath, revenueImpact } from "@tracki/clickhouse";
import {
  type RevenueCounts,
  type RevenueImpact,
  type RevenueSettings,
  revenueImpactFrom,
} from "@tracki/shared";

export interface RevenuePathView {
  path: string;
  struggling: number;
  atRisk: number;
  atRiskMoney: number;
}

export interface RevenueInsights {
  counts: RevenueCounts;
  impact: RevenueImpact;
  paths: RevenuePathView[];
}

/**
 * Revenue Impact (implementation): sessionized friction counts from ClickHouse × the
 * merchant's AOV. Project-scoped; aggregate-only. ClickHouse being unavailable
 * yields zeros (honest empty state), never a thrown page.
 */
export async function gatherRevenue(
  orgId: string,
  projectId: string,
  settings: RevenueSettings,
  days = 30,
): Promise<RevenueInsights> {
  const ch = clickhouse();
  const [tot, paths] = await Promise.all([
    revenueImpact(ch, orgId, projectId, days, settings.conversionEvent).catch(() => ({
      struggling: "0",
      converted: "0",
      recovered: "0",
      at_risk: "0",
    })),
    revenueByPath(ch, orgId, projectId, days, settings.conversionEvent, 6).catch(() => []),
  ]);

  const counts: RevenueCounts = {
    struggling: Number(tot.struggling),
    converted: Number(tot.converted),
    recovered: Number(tot.recovered),
    atRisk: Number(tot.at_risk),
  };
  const aov = settings.avgOrderValue;
  return {
    counts,
    impact: revenueImpactFrom(counts, aov),
    paths: paths.map((p) => ({
      path: p.path,
      struggling: Number(p.struggling),
      atRisk: Number(p.at_risk),
      atRiskMoney: Number(p.at_risk) * Math.max(0, aov),
    })),
  };
}
