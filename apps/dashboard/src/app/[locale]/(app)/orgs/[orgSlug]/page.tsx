import { CreateProjectForm } from "@/components/org-forms";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { requireMembership } from "@/lib/tenancy";
import { MANAGER_ROLES } from "@tracki/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function OrgProjectsPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const t = await getTranslations("org");

  const orgProjects = await db
    .select({ name: projects.name, slug: projects.slug, siteUrl: projects.siteUrl })
    .from(projects)
    .where(eq(projects.orgId, org.id));

  const canManage = MANAGER_ROLES.includes(role);

  return (
    <div className="space-y-8">
      <PageHeader title={t("projectsTitle")} />

      {orgProjects.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("projectsEmpty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {orgProjects.map((project) => (
            <Link
              key={project.slug}
              href={`/orgs/${orgSlug}/projects/${project.slug}`}
              className="group"
            >
              <Card className="transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:hover:border-blue-700">
                <CardContent className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
                    aria-hidden="true"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1.5" />
                      <rect x="14" y="3" width="7" height="7" rx="1.5" />
                      <rect x="3" y="14" width="7" height="7" rx="1.5" />
                      <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                      {project.name}
                    </p>
                    {project.siteUrl ? (
                      <p className="truncate text-sm text-zinc-500 dark:text-zinc-400" dir="ltr">
                        {project.siteUrl}
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("createProjectTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateProjectForm locale={locale} orgSlug={orgSlug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
