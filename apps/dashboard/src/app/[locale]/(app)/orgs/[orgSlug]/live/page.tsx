import { LiveStream } from "@/components/live-stream";
import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireMembership } from "@/lib/tenancy";
import { Card, CardContent } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug } = await searchParams;
  const t = await getTranslations("live");

  const orgProjects = await db
    .select({ name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));

  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

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
            basePath={`/orgs/${orgSlug}/live`}
          />

          <Card>
            <CardContent>
              {active ? (
                <LiveStream orgSlug={orgSlug} projectSlug={active.slug} />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pickProject")}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
