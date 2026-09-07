import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { StruggleFeed } from "@/components/struggle-feed";
import { StruggleOverview } from "@/components/struggle-overview";
import { StruggleReport } from "@/components/struggle-report";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { clickhouse } from "@/lib/analytics";
import { requireMembership } from "@/lib/tenancy";
import { recentStruggles, struggleSeverityCounts } from "@tracki/clickhouse";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function StrugglesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("struggles");

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));

  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  let initial: Awaited<ReturnType<typeof recentStruggles>> = [];
  const sev = { high: 0, medium: 0, low: 0 };
  if (active) {
    try {
      const [recent, counts] = await Promise.all([
        recentStruggles(clickhouse(), org.id, active.id, 50),
        struggleSeverityCounts(clickhouse(), org.id, active.id, 14),
      ]);
      initial = recent;
      for (const c of counts) {
        if (c.severity in sev) sev[c.severity as keyof typeof sev] = Number(c.count);
      }
    } catch {
      initial = [];
    }
  }

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
            basePath={`/orgs/${orgSlug}/struggles`}
          />

          {active ? (
            <>
              <StruggleOverview counts={sev} />

              <Card>
                <CardContent>
                  <StruggleFeed
                    orgSlug={orgSlug}
                    projectSlug={active.slug}
                    initial={initial.map((s) => ({
                      struggle_id: s.struggle_id,
                      type: s.type,
                      severity: s.severity,
                      path: s.path,
                      element: s.element,
                      reason: s.reason,
                      anon_id: s.anon_id,
                      user_id: s.user_id,
                      score: s.score,
                      ts: s.ts,
                    }))}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("reportTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <StruggleReport
                    orgSlug={orgSlug}
                    projectSlug={active.slug}
                    orgId={org.id}
                    projectId={active.id}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pickProject")}</p>
          )}
        </>
      )}
    </div>
  );
}
