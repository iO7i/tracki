import { ActionAutopilot } from "@/components/action-autopilot";
import { ActionBuilder, type BuilderInitial } from "@/components/action-builder";
import { ActionOutcomes } from "@/components/action-outcomes";
import { ActionResults } from "@/components/action-results";
import { AssistReport } from "@/components/assist-report";
import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { actions, projects, segments } from "@/db/schema";
import { gatherActionProposals } from "@/lib/action-studio";
import { deleteActionAction, toggleActionAction } from "@/lib/actions/action";
import { generateActionProposalsAction } from "@/lib/actions/action-studio";
import { requireMembership } from "@/lib/tenancy";
import { type ActionDefinition, MANAGER_ROLES } from "@tracki/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string; edit?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug, edit } = await searchParams;
  const t = await getTranslations("actions");

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  const list = active
    ? await db
        .select({ id: actions.id, name: actions.name, type: actions.type, status: actions.status })
        .from(actions)
        .where(eq(actions.projectId, active.id))
    : [];
  const names = Object.fromEntries(list.map((a) => [a.id, a.name]));
  const segmentList = active
    ? await db
        .select({ id: segments.id, name: segments.name })
        .from(segments)
        .where(eq(segments.projectId, active.id))
    : [];
  const canManage = MANAGER_ROLES.includes(role);

  // Slice 12 — Autopilot queue + edit-in-place (the edited action is loaded
  // project-scoped; a foreign/invalid id silently falls back to create mode).
  const proposals = active ? await gatherActionProposals(active.id) : [];
  let editing: BuilderInitial | undefined;
  if (active && canManage && edit && UUID_RE.test(edit)) {
    const [row] = await db
      .select({
        id: actions.id,
        name: actions.name,
        status: actions.status,
        definition: actions.definition,
      })
      .from(actions)
      .where(and(eq(actions.id, edit), eq(actions.projectId, active.id)))
      .limit(1);
    if (row) {
      editing = {
        id: row.id,
        name: row.name,
        status: row.status as "draft" | "live",
        definition: row.definition as ActionDefinition,
      };
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
            basePath={`/orgs/${orgSlug}/actions`}
          />

          {active && (
            <>
              {/* Slice 12 — Tracki Autopilot: AI-proposed actions from the friction report. */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t("autopilotTitle")}</CardTitle>
                  {canManage && (
                    <form action={generateActionProposalsAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="projectSlug" value={active.slug} />
                      <Button type="submit" size="sm">
                        {t("generate")}
                      </Button>
                    </form>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                    {t("autopilotSubtitle")}
                  </p>
                  <ActionAutopilot
                    locale={locale}
                    orgSlug={orgSlug}
                    projectSlug={active.slug}
                    proposals={proposals}
                    canManage={canManage}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("listTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {list.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {list.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{a.name}</span>
                            <Badge>
                              {t(
                                `type${a.type.charAt(0).toUpperCase()}${a.type.slice(1)}` as "typePopup",
                              )}
                            </Badge>
                            <Badge tone={a.status === "live" ? "success" : "neutral"}>
                              {t(a.status as "live")}
                            </Badge>
                          </div>
                          {canManage && (
                            <div className="flex items-center gap-3">
                              <a
                                href={`/${locale}/orgs/${orgSlug}/actions?project=${active.slug}&edit=${a.id}#builder`}
                                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                              >
                                {t("edit")}
                              </a>
                              <form action={toggleActionAction}>
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="orgSlug" value={orgSlug} />
                                <input type="hidden" name="projectSlug" value={active.slug} />
                                <input type="hidden" name="actionId" value={a.id} />
                                <input
                                  type="hidden"
                                  name="next"
                                  value={a.status === "live" ? "draft" : "live"}
                                />
                                <button
                                  type="submit"
                                  className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {a.status === "live" ? t("pause") : t("goLive")}
                                </button>
                              </form>
                              <form action={deleteActionAction}>
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="orgSlug" value={orgSlug} />
                                <input type="hidden" name="projectSlug" value={active.slug} />
                                <input type="hidden" name="actionId" value={a.id} />
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
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("resultsTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActionResults orgId={org.id} projectId={active.id} names={names} />
                </CardContent>
              </Card>

              {/* Slice 12 — Outcomes: recovery of struggling sessions + channel split. */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("outcomesTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActionOutcomes orgId={org.id} projectId={active.id} names={names} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("assistReportTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <AssistReport orgId={org.id} projectId={active.id} names={names} />
                </CardContent>
              </Card>

              {canManage && (
                <Card id="builder">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>{editing ? t("editTitle") : t("createTitle")}</CardTitle>
                    {editing && (
                      <a
                        href={`/${locale}/orgs/${orgSlug}/actions?project=${active.slug}`}
                        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {t("cancelEdit")}
                      </a>
                    )}
                  </CardHeader>
                  <CardContent>
                    <ActionBuilder
                      key={editing?.id ?? "new"}
                      locale={locale}
                      orgSlug={orgSlug}
                      projectSlug={active.slug}
                      segments={segmentList}
                      initial={editing}
                    />
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
