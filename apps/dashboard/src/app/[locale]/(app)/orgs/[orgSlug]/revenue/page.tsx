import { MobileRevenuePanels } from "@/components/mobile-revenue";
import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { RevenueImpactView } from "@/components/revenue-impact";
import { RevenueSettingsForm } from "@/components/revenue-settings";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { gatherMobileRevenue } from "@/lib/mobile";
import { gatherRevenue } from "@/lib/revenue";
import { requireMembership } from "@/lib/tenancy";
import { MANAGER_ROLES, type RevenueSettings } from "@tracki/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function RevenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("revenue");

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
  const canManage = MANAGER_ROLES.includes(role);

  const settings: RevenueSettings | null = active
    ? {
        currency: active.currency as RevenueSettings["currency"],
        avgOrderValue: active.avgOrderValue,
        conversionEvent: active.conversionEvent,
      }
    : null;
  const [insights, mobileInsights] =
    active && settings
      ? await Promise.all([
          gatherRevenue(org.id, active.id, settings, 30),
          gatherMobileRevenue(org.id, active.id, settings, 30),
        ])
      : [null, null];

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
            basePath={`/orgs/${orgSlug}/revenue`}
          />

          {active && settings && insights ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("impactTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <RevenueImpactView
                    insights={insights}
                    currency={settings.currency}
                    locale={locale}
                    aovSet={settings.avgOrderValue > 0}
                    days={30}
                  />
                </CardContent>
              </Card>

              {/* implementation: recovery cut by struggle type / device / app version. */}
              {mobileInsights &&
                (mobileInsights.byStruggleType.length > 0 ||
                  mobileInsights.byPlatform.length > 0 ||
                  mobileInsights.byAppVersion.length > 0) && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("dimensionsTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <MobileRevenuePanels
                        insights={mobileInsights}
                        currency={settings.currency}
                        locale={locale}
                        aovSet={settings.avgOrderValue > 0}
                      />
                    </CardContent>
                  </Card>
                )}

              {canManage && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("settingsTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <RevenueSettingsForm
                      locale={locale}
                      orgSlug={orgSlug}
                      projectSlug={active.slug}
                      currency={settings.currency}
                      avgOrderValue={settings.avgOrderValue}
                      conversionEvent={settings.conversionEvent}
                    />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("settingsHint")}</p>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pickProject")}</p>
          )}
        </>
      )}
    </div>
  );
}
