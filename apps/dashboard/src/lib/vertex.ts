import "server-only";
import { clickhouse } from "@/lib/analytics";
import { vertexCohorts, vertexFunnel } from "@tracki/clickhouse";

/** Ordered happy-path funnel stages (keys match the vertex i18n namespace). */
export const VERTEX_FUNNEL_STAGES = [
  "landing",
  "booking_started",
  "booking_completed",
  "signup",
  "platform_selected",
  "oauth_started",
  "store_connected",
  "first_sync",
  "first_report",
  "subscription",
] as const;
export type VertexStage = (typeof VERTEX_FUNNEL_STAGES)[number];

/** Drop-off cohorts (keys match the vertex i18n namespace). */
export const VERTEX_COHORTS = [
  "booking_abandoned",
  "oauth_failures",
  "converted_no_store",
  "connected_no_report",
  "activated_not_subscribed",
] as const;
export type VertexCohort = (typeof VERTEX_COHORTS)[number];

export interface VertexFunnelView {
  stages: { key: VertexStage; count: number }[];
  cohorts: { key: VertexCohort; count: number }[];
}

/**
 * Vertex activation funnel + drop-off cohorts for the operator view.
 * Project-scoped, aggregate-only. ClickHouse being unavailable yields zeros
 * (honest empty state), never a thrown page.
 */
export async function gatherVertexFunnel(
  orgId: string,
  projectId: string,
  days = 30,
): Promise<VertexFunnelView> {
  const ch = clickhouse();
  const [f, c] = await Promise.all([
    vertexFunnel(ch, orgId, projectId, days).catch(() => null),
    vertexCohorts(ch, orgId, projectId, days).catch(() => null),
  ]);

  const stages: { key: VertexStage; count: number }[] = [
    { key: "landing", count: Number(f?.landing ?? 0) },
    { key: "booking_started", count: Number(f?.booking_started ?? 0) },
    { key: "booking_completed", count: Number(f?.booking_completed ?? 0) },
    { key: "signup", count: Number(f?.signup ?? 0) },
    { key: "platform_selected", count: Number(f?.platform_selected ?? 0) },
    { key: "oauth_started", count: Number(f?.oauth_started ?? 0) },
    { key: "store_connected", count: Number(f?.store_connected ?? 0) },
    { key: "first_sync", count: Number(f?.first_sync ?? 0) },
    { key: "first_report", count: Number(f?.first_report ?? 0) },
    { key: "subscription", count: Number(f?.subscription ?? 0) },
  ];

  const cohorts: { key: VertexCohort; count: number }[] = [
    { key: "booking_abandoned", count: Number(c?.booking_abandoned ?? 0) },
    { key: "oauth_failures", count: Number(c?.oauth_failures ?? 0) },
    { key: "converted_no_store", count: Number(c?.converted_no_store ?? 0) },
    { key: "connected_no_report", count: Number(c?.connected_no_report ?? 0) },
    { key: "activated_not_subscribed", count: Number(c?.activated_not_subscribed ?? 0) },
  ];

  return { stages, cohorts };
}
