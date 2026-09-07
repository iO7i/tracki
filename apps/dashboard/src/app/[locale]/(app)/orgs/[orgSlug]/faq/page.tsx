import { FaqCsvImport, FaqEditor } from "@/components/faq-forms";
import { FaqReportView } from "@/components/faq-report";
import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { faqArticles, projects } from "@/db/schema";
import { deleteFaqAction, toggleFaqAction } from "@/lib/actions/faq";
import { requireMembership } from "@/lib/tenancy";
import { MANAGER_ROLES, coverage } from "@tracki/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function FaqPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string; draft?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug, draft } = await searchParams;
  const t = await getTranslations("faq");
  // VoC "Draft FAQ" hand-off (slice 8): prefill the title in the question's language.
  const draftTitle = draft?.slice(0, 200);
  const draftIsArabic = draftTitle ? /[؀-ۿ]/.test(draftTitle) : false;

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug, key: projects.publicKey })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  const list = active
    ? await db
        .select({
          id: faqArticles.id,
          titleAr: faqArticles.titleAr,
          titleEn: faqArticles.titleEn,
          category: faqArticles.category,
          status: faqArticles.status,
        })
        .from(faqArticles)
        .where(eq(faqArticles.projectId, active.id))
    : [];
  const canManage = MANAGER_ROLES.includes(role);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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
            basePath={`/orgs/${orgSlug}/faq`}
          />

          {active && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t("listTitle")}</CardTitle>
                  <a
                    href={`${appUrl}/${locale}/help/${active.key}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {t("helpCenterLink")}
                  </a>
                </CardHeader>
                <CardContent>
                  {list.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {list.map((a) => {
                        const cov = coverage({ title: a.titleAr }, { title: a.titleEn });
                        return (
                          <li key={a.id} className="flex items-center justify-between gap-2 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">
                                {a.titleAr || a.titleEn || "—"}
                              </span>
                              {a.category && <Badge>{a.category}</Badge>}
                              <Badge tone={a.status === "published" ? "success" : "neutral"}>
                                {t(a.status as "published")}
                              </Badge>
                              {!cov.ar && <Badge tone="warning">{t("missingAr")}</Badge>}
                              {!cov.en && <Badge tone="warning">{t("missingEn")}</Badge>}
                            </div>
                            {canManage && (
                              <div className="flex items-center gap-3">
                                <form action={toggleFaqAction}>
                                  <input type="hidden" name="locale" value={locale} />
                                  <input type="hidden" name="orgSlug" value={orgSlug} />
                                  <input type="hidden" name="projectSlug" value={active.slug} />
                                  <input type="hidden" name="articleId" value={a.id} />
                                  <input
                                    type="hidden"
                                    name="next"
                                    value={a.status === "published" ? "draft" : "published"}
                                  />
                                  <button
                                    type="submit"
                                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    {a.status === "published" ? t("unpublish") : t("publish")}
                                  </button>
                                </form>
                                <form action={deleteFaqAction}>
                                  <input type="hidden" name="locale" value={locale} />
                                  <input type="hidden" name="orgSlug" value={orgSlug} />
                                  <input type="hidden" name="projectSlug" value={active.slug} />
                                  <input type="hidden" name="articleId" value={a.id} />
                                  <button
                                    type="submit"
                                    className="text-sm text-red-600 hover:underline dark:text-red-400"
                                  >
                                    {t("delete")}
                                  </button>
                                </form>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("reportTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FaqReportView orgId={org.id} projectId={active.id} />
                </CardContent>
              </Card>

              {canManage && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("createTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FaqEditor
                        locale={locale}
                        orgSlug={orgSlug}
                        projectSlug={active.slug}
                        initialTitleAr={draftIsArabic ? draftTitle : undefined}
                        initialTitleEn={draftIsArabic ? undefined : draftTitle}
                      />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("importTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FaqCsvImport locale={locale} orgSlug={orgSlug} projectSlug={active.slug} />
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
