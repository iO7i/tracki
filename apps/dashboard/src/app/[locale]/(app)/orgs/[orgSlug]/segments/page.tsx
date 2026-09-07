import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { SegmentBuilder } from "@/components/segment-builder";
import { db } from "@/db";
import { projects, segments } from "@/db/schema";
import { deleteSegmentAction } from "@/lib/actions/segment";
import { requireMembership } from "@/lib/tenancy";
import type { SegmentDefinition } from "@tracki/shared";
import { MANAGER_ROLES } from "@tracki/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function SegmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("segments");

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  const saved = active
    ? await db
        .select({ id: segments.id, name: segments.name, definition: segments.definition })
        .from(segments)
        .where(eq(segments.projectId, active.id))
    : [];

  const canManage = MANAGER_ROLES.includes(role);

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
            basePath={`/orgs/${orgSlug}/segments`}
          />

          {active && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("listTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {saved.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {saved.map((s) => {
                        const def = s.definition as SegmentDefinition;
                        return (
                          <li key={s.id} className="flex items-center justify-between py-3">
                            <div>
                              <p className="text-sm font-medium">{s.name}</p>
                              <Badge>
                                {t("conditionsCount", { count: def.conditions.length })}
                              </Badge>
                            </div>
                            {canManage && (
                              <form action={deleteSegmentAction}>
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="orgSlug" value={orgSlug} />
                                <input type="hidden" name="projectSlug" value={active.slug} />
                                <input type="hidden" name="segmentId" value={s.id} />
                                <button
                                  type="submit"
                                  className="text-sm text-red-600 hover:underline dark:text-red-400"
                                >
                                  {t("delete")}
                                </button>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {canManage && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("createTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SegmentBuilder locale={locale} orgSlug={orgSlug} projectSlug={active.slug} />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
