import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { gatherVertexFunnel } from "@/lib/vertex";
import { requireMembership } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function VertexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("vertex");

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  const view = active ? await gatherVertexFunnel(org.id, active.id, 30) : null;
  const maxStage = view ? Math.max(...view.stages.map((s) => s.count), 1) : 1;
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {orgProjects.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noProjects")}</p>
      ) : (
        <>
          <ProjectTabs items={orgProjects} activeSlug={active?.slug} basePath={`/orgs/${orgSlug}/vertex`} />

          {active && view ? (
            <>
              {/* Activation funnel — distinct visitors per stage. */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("funnelTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {view.stages.map((s) => (
                    <div key={s.key} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-sm text-zinc-600 dark:text-zinc-300">
                        {t(`stage.${s.key}`)}
                      </span>
                      <div className="relative h-6 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded bg-emerald-500/80"
                          style={{ inlineSize: `${Math.round((s.count / maxStage) * 100)}%` }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-end text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {nf.format(s.count)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Drop-off cohorts — where the funnel leaks and who to nudge. */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("cohortsTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {view.cohorts.map((c) => (
                      <div
                        key={c.key}
                        className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                      >
                        <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {nf.format(c.count)}
                        </div>
                        <div className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          {t(`cohort.${c.key}`)}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {t(`cohort.${c.key}Desc`)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("footnote")}</p>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pickProject")}</p>
          )}
        </>
      )}
    </div>
  );
}
