import { PageHeader, StatCard } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { requireMembership } from "@/lib/tenancy";
import { gatherVoc } from "@/lib/voc";
import { MANAGER_ROLES } from "@tracki/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function VocPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("voc");

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;
  const canManage = MANAGER_ROLES.includes(role);

  const voc = active ? await gatherVoc(org.id, active.id) : null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

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
            basePath={`/orgs/${orgSlug}/voc`}
          />

          {active && voc && (
            <>
              {/* Overview */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label={t("inquiries")} value={String(voc.totals.inquiries)} accent />
                <StatCard label={t("selfResolution")} value={pct(voc.totals.selfResolutionRate)} />
                <StatCard label={t("escalationRate")} value={pct(voc.totals.escalationRate)} />
                <StatCard label={t("unanswered")} value={String(voc.totals.unanswered)} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Top themes */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t("themesTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {voc.themes.length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
                    ) : (
                      <ul className="space-y-3">
                        {voc.themes.map((th) => (
                          <li key={th.label}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{th.label}</span>
                              <Badge>{th.count}</Badge>
                            </div>
                            {th.example && (
                              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                                {th.example}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Knowledge gaps → Draft FAQ */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t("gapsTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {voc.gaps.length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("gapsEmpty")}</p>
                    ) : (
                      <ul className="space-y-3">
                        {voc.gaps.map((g) => (
                          <li key={g.question} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{g.question}</p>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {t(g.source === "search" ? "sourceSearch" : "sourceEscalation")} ·{" "}
                                {g.count}
                              </span>
                            </div>
                            {canManage && (
                              <Link
                                href={{
                                  pathname: `/orgs/${orgSlug}/faq`,
                                  query: { project: active.slug, draft: g.question },
                                }}
                                className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                {t("draftFaq")}
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Friction map */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("frictionTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {voc.friction.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("frictionEmpty")}</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {voc.friction.map((f) => (
                        <li key={f.path} className="flex items-center justify-between gap-2 py-2">
                          <span className="truncate text-sm" dir="ltr">
                            {f.path || "—"}
                          </span>
                          <Badge tone="warning">{f.count}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
