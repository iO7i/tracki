import { PageHeader, StatCard } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { projects } from "@/db/schema";
import {
  approveProposalAction,
  generateProposalsAction,
  rejectProposalAction,
} from "@/lib/actions/knowledge";
import { gatherKnowledge } from "@/lib/knowledge";
import { requireMembership } from "@/lib/tenancy";
import { MANAGER_ROLES } from "@tracki/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

const fieldCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-xs dark:border-zinc-700 dark:bg-zinc-900/60";

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("knowledge");

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;
  const canManage = MANAGER_ROLES.includes(role);

  const data = active ? await gatherKnowledge(active.id) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          active && canManage ? (
            <form action={generateProposalsAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="projectSlug" value={active.slug} />
              <Button type="submit" size="sm">
                {t("generate")}
              </Button>
            </form>
          ) : undefined
        }
      />

      {orgProjects.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noProjects")}</p>
      ) : (
        <>
          <ProjectTabs
            items={orgProjects}
            activeSlug={active?.slug}
            basePath={`/orgs/${orgSlug}/knowledge`}
          />

          {active && data && (
            <>
              {/* Knowledge health */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard label={t("published")} value={String(data.health.published)} accent />
                <StatCard label={t("missingLocale")} value={String(data.health.missingLocale)} />
                <StatCard label={t("stale")} value={String(data.health.stale)} />
              </div>

              {/* Review queue */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("queueTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.proposals.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("queueEmpty")}</p>
                  ) : (
                    <ul className="space-y-6">
                      {data.proposals.map((p) => (
                        <li
                          key={p.id}
                          className="rounded-xl border border-zinc-200/80 p-4 dark:border-zinc-800"
                        >
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{p.question}</span>
                            <Badge tone="warning">
                              {t(p.source === "search" ? "sourceSearch" : "sourceEscalation")}
                            </Badge>
                            <Badge>{t("seenTimes", { count: p.occurrences })}</Badge>
                          </div>

                          {canManage ? (
                            <form action={approveProposalAction} className="space-y-3">
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="orgSlug" value={orgSlug} />
                              <input type="hidden" name="projectSlug" value={active.slug} />
                              <input type="hidden" name="proposalId" value={p.id} />
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2" dir="rtl">
                                  <Label>{t("titleAr")}</Label>
                                  <Input name="titleAr" defaultValue={p.draft.titleAr} />
                                  <Label>{t("bodyAr")}</Label>
                                  <textarea
                                    name="bodyAr"
                                    rows={4}
                                    defaultValue={p.draft.bodyAr}
                                    className={fieldCls}
                                  />
                                </div>
                                <div className="space-y-2" dir="ltr">
                                  <Label>{t("titleEn")}</Label>
                                  <Input name="titleEn" defaultValue={p.draft.titleEn} />
                                  <Label>{t("bodyEn")}</Label>
                                  <textarea
                                    name="bodyEn"
                                    rows={4}
                                    defaultValue={p.draft.bodyEn}
                                    className={fieldCls}
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button type="submit" size="sm">
                                  {t("approve")}
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="secondary"
                                  formAction={rejectProposalAction}
                                >
                                  {t("reject")}
                                </Button>
                              </div>
                            </form>
                          ) : (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              {p.draft.titleEn || p.draft.titleAr}
                            </p>
                          )}
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
