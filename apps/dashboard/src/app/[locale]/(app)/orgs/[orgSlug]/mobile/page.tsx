import { JourneyScores } from "@/components/journey-scores";
import { MobileHeatmaps } from "@/components/mobile-heatmaps";
import { PageHeader, StatCard } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { gatherMobile } from "@/lib/mobile";
import { requireMembership } from "@/lib/tenancy";
import type { RevenueSettings } from "@tracki/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

/**
 * Mobile Journey Intelligence (slice 14): friction heatmaps over app screens,
 * journey scores per session, and the screens worth intervening on first.
 * Same loop as web — observe → detect → intervene → measure — over the mobile
 * SDK traffic (platform ios/android).
 */
export default async function MobilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("mobile");

  const orgProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      currency: projects.currency,
      avgOrderValue: projects.avgOrderValue,
      conversionEvent: projects.conversionEvent,
    })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  const settings: RevenueSettings | null = active
    ? {
        currency: active.currency as RevenueSettings["currency"],
        avgOrderValue: active.avgOrderValue,
        conversionEvent: active.conversionEvent,
      }
    : null;
  const insights = active && settings ? await gatherMobile(org.id, active.id, settings, 30) : null;

  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const avgScore =
    insights && insights.journeys.length > 0
      ? Math.round(
          insights.journeys.reduce((s, j) => s + j.score.score, 0) / insights.journeys.length,
        )
      : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {orgProjects.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noProjects")}</p>
      ) : (
        <>
          <ProjectTabs
            items={orgProjects}
            activeSlug={active?.slug}
            basePath={`/orgs/${orgSlug}/mobile`}
          />

          {active && settings && insights ? (
            !insights.hasMobileTraffic ? (
              <Card>
                <CardContent>
                  <div className="space-y-2 py-8 text-center">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      {t("noTrafficTitle")}
                    </p>
                    <p className="mx-auto max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                      {t("noTrafficBody")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatCard
                    label={t("avgScore")}
                    value={avgScore === null ? "—" : num(avgScore)}
                    hint={t("avgScoreHint", { count: num(insights.journeys.length) })}
                    accent
                  />
                  <StatCard
                    label={t("frictionScreensStat")}
                    value={num(insights.frictionScreens.length)}
                    hint={insights.frictionScreens[0]?.path ?? ""}
                  />
                  <StatCard
                    label={t("opportunitiesStat")}
                    value={num(insights.frictionScreens.filter((s) => s.uncovered).length)}
                    hint={t("opportunitiesStatHint")}
                  />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("heatmapsTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <MobileHeatmaps
                      insights={insights}
                      currency={settings.currency}
                      locale={locale}
                      aovSet={settings.avgOrderValue > 0}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("journeysTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <JourneyScores
                      journeys={insights.journeys}
                      orgSlug={orgSlug}
                      projectSlug={active.slug}
                    />
                  </CardContent>
                </Card>
              </>
            )
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pickProject")}</p>
          )}
        </>
      )}
    </div>
  );
}
