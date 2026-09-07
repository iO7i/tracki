import "server-only";
import { db } from "@/db";
import { actions } from "@/db/schema";
import { clickhouse } from "@/lib/analytics";
import {
  abandonmentScreens,
  frictionScreens,
  recoveryByStruggleType,
  revenueByDimension,
  sessionJourneys,
} from "@tracki/clickhouse";
import {
  type JourneyScore,
  type RevenueSettings,
  journeyScore,
  mobileCoverageTargets,
} from "@tracki/shared";
import { and, eq } from "drizzle-orm";

/**
 * Mobile Journey Intelligence (implementation) — friction heatmaps, journey scores
 * and revenue dimension cuts over the mobile SDK traffic. Project-scoped,
 * aggregate/masked data only. ClickHouse being unavailable yields empty
 * arrays (honest empty state), never a thrown page.
 */

export interface FrictionScreenView {
  path: string;
  count: number;
  friction: number;
  topType: string;
  /** No live action currently targets this screen — an open opportunity. */
  uncovered: boolean;
  atRiskMoney: number;
}

export interface AbandonmentScreenView {
  path: string;
  ended: number;
  abandons: number;
}

export interface SessionJourneyView {
  sessionId: string;
  visitor: string;
  anonId: string;
  started: string;
  ended: string;
  screens: number;
  struggles: number;
  completedFlows: number;
  abandonedFlows: number;
  converted: boolean;
  platform: string;
  appVersion: string;
  score: JourneyScore;
}

export interface StruggleRecoveryView {
  type: string;
  struggling: number;
  recovered: number;
  atRisk: number;
  atRiskMoney: number;
  recoveredMoney: number;
}

export interface DimensionRecoveryView {
  dim: string;
  struggling: number;
  recovered: number;
  atRisk: number;
  atRiskMoney: number;
  recoveredMoney: number;
}

export interface MobileInsights {
  frictionScreens: FrictionScreenView[];
  abandonment: AbandonmentScreenView[];
  journeys: SessionJourneyView[];
  hasMobileTraffic: boolean;
}

export interface MobileRevenueInsights {
  byStruggleType: StruggleRecoveryView[];
  byAppVersion: DimensionRecoveryView[];
  byPlatform: DimensionRecoveryView[];
}

/**
 * Substring targets of LIVE actions that can actually reach mobile SDKs, to
 * flag uncovered screens. Audit-14 M1+M3: web-only actions cover nothing on
 * mobile, and only struggle-trigger (Live Assist) actions blanket-cover —
 * the rules live in the shared, unit-tested `mobileCoverageTargets`.
 */
async function liveActionTargets(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ definition: actions.definition })
    .from(actions)
    .where(and(eq(actions.projectId, projectId), eq(actions.status, "live")));
  return mobileCoverageTargets(
    rows.map(
      (r) =>
        r.definition as {
          surface?: import("@tracki/shared").ActionSurface;
          urlContains?: string;
          trigger?: { kind?: string };
        },
    ),
  );
}

export async function gatherMobile(
  orgId: string,
  projectId: string,
  settings: RevenueSettings,
  days = 30,
): Promise<MobileInsights> {
  const ch = clickhouse();
  const aov = Math.max(0, settings.avgOrderValue);
  const [screens, abandonment, journeys, targets] = await Promise.all([
    frictionScreens(ch, orgId, projectId, days, 8).catch(() => []),
    abandonmentScreens(ch, orgId, projectId, days, settings.conversionEvent, 8).catch(() => []),
    sessionJourneys(ch, orgId, projectId, days, settings.conversionEvent, 20).catch(() => []),
    liveActionTargets(projectId).catch((): string[] => []),
  ]);

  const covered = (path: string) => targets.includes("*") || targets.some((t) => path.includes(t));
  // At-risk money per screen: non-converted ended sessions × AOV (same honesty
  // rules as implementation — AOV unset ⇒ 0, the UI shows a prompt instead).
  const endedByPath = new Map(abandonment.map((a) => [a.path, Number(a.ended)]));

  return {
    frictionScreens: screens.map((s) => ({
      path: s.path,
      count: Number(s.count),
      friction: Number(s.friction),
      topType: s.top_type,
      uncovered: !covered(s.path),
      atRiskMoney: (endedByPath.get(s.path) ?? 0) * aov,
    })),
    abandonment: abandonment.map((a) => ({
      path: a.path,
      ended: Number(a.ended),
      abandons: Number(a.abandons),
    })),
    journeys: journeys.map((j) => ({
      sessionId: j.session_id,
      visitor: j.visitor,
      anonId: j.anon_id,
      started: j.started,
      ended: j.ended,
      screens: Number(j.screens),
      struggles: Number(j.struggle_count),
      completedFlows: Number(j.completed_flows),
      abandonedFlows: Number(j.abandoned_flows),
      converted: j.converted === "1",
      platform: j.plat,
      appVersion: j.app_ver,
      score: journeyScore({
        struggleScoreSum: Number(j.friction),
        flowsAbandoned: Number(j.abandoned_flows),
        flowsCompleted: Number(j.completed_flows),
        converted: j.converted === "1",
      }),
    })),
    hasMobileTraffic: journeys.length > 0 || screens.length > 0,
  };
}

export async function gatherMobileRevenue(
  orgId: string,
  projectId: string,
  settings: RevenueSettings,
  days = 30,
): Promise<MobileRevenueInsights> {
  const ch = clickhouse();
  const aov = Math.max(0, settings.avgOrderValue);
  const [byType, byVersion, byPlatform] = await Promise.all([
    recoveryByStruggleType(ch, orgId, projectId, days, settings.conversionEvent).catch(() => []),
    revenueByDimension(ch, orgId, projectId, "app_version", days, settings.conversionEvent).catch(
      () => [],
    ),
    revenueByDimension(ch, orgId, projectId, "platform", days, settings.conversionEvent).catch(
      () => [],
    ),
  ]);

  const view = (r: { struggling: string; recovered: string; at_risk: string }) => ({
    struggling: Number(r.struggling),
    recovered: Number(r.recovered),
    atRisk: Number(r.at_risk),
    atRiskMoney: Number(r.at_risk) * aov,
    recoveredMoney: Number(r.recovered) * aov,
  });

  return {
    byStruggleType: byType.map((r) => ({ type: r.struggle_type, ...view(r) })),
    byAppVersion: byVersion.map((r) => ({ dim: r.dim, ...view(r) })),
    byPlatform: byPlatform.map((r) => ({ dim: r.dim, ...view(r) })),
  };
}
