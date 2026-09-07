import { PageHeader, StatCard } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { db } from "@/db";
import { chatMessages, conversations, projects } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { setResolutionAction } from "@/lib/actions/agent";
import { requireMembership } from "@/lib/tenancy";
import { CHAT_RESOLUTIONS, MANAGER_ROLES } from "@tracki/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { desc, eq, sql } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";

const statusKey: Record<string, "statusOpen"> = {
  open: "statusOpen",
  self_resolved: "statusSelfResolved" as "statusOpen",
  escalated: "statusEscalated" as "statusOpen",
  abandoned: "statusAbandoned" as "statusOpen",
};

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string; c?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug, c: convoId } = await searchParams;
  const t = await getTranslations("agent");
  const format = await getFormatter();

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;
  const canManage = MANAGER_ROLES.includes(role);

  const convos = active
    ? await db
        .select({
          id: conversations.id,
          status: conversations.status,
          escalated: conversations.escalated,
          lastAt: conversations.lastAt,
        })
        .from(conversations)
        .where(eq(conversations.projectId, active.id))
        .orderBy(desc(conversations.lastAt))
        .limit(100)
    : [];

  // Report aggregates.
  const total = convos.length;
  const escalated = convos.filter((c) => c.escalated === "true").length;
  const grounded = active
    ? ((
        await db
          .select({ n: sql<number>`count(*)` })
          .from(chatMessages)
          .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
          .where(
            sql`${conversations.projectId} = ${active.id} AND ${chatMessages.role} = 'assistant' AND ${chatMessages.citationArticleId} IS NOT NULL`,
          )
      )[0]?.n ?? 0)
    : 0;
  const assistantMsgs = active
    ? ((
        await db
          .select({ n: sql<number>`count(*)` })
          .from(chatMessages)
          .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
          .where(
            sql`${conversations.projectId} = ${active.id} AND ${chatMessages.role} = 'assistant'`,
          )
      )[0]?.n ?? 0)
    : 0;

  // Selected transcript (project-scoped).
  const selected = convoId && active ? convos.find((c) => c.id === convoId) : undefined;
  const messages = selected
    ? await db
        .select({
          role: chatMessages.role,
          content: chatMessages.content,
          citation: chatMessages.citationArticleId,
        })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, selected.id))
        .orderBy(chatMessages.createdAt)
    : [];

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

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
            basePath={`/orgs/${orgSlug}/agent`}
          />

          {active && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label={t("totalConvos")} value={String(total)} accent />
                <StatCard label={t("escalationRate")} value={pct(escalated, total)} />
                <StatCard
                  label={t("groundedRate")}
                  value={pct(Number(grounded), Number(assistantMsgs))}
                />
              </div>

              {/* Resolution breakdown — aggregates every status (incl. abandoned). */}
              {total > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {CHAT_RESOLUTIONS.map((s) => (
                    <span key={s}>
                      {t(statusKey[s] ?? "statusOpen")}:{" "}
                      <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                        {convos.filter((c) => c.status === s).length}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("conversations")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {convos.length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
                    ) : (
                      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {convos.map((c) => (
                          <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                            <Link
                              href={{
                                pathname: `/orgs/${orgSlug}/agent`,
                                query: { project: active.slug, c: c.id },
                              }}
                              className={`truncate text-sm hover:underline ${
                                selected?.id === c.id ? "font-semibold text-blue-600" : ""
                              }`}
                            >
                              {format.dateTime(c.lastAt, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </Link>
                            {c.escalated === "true" && (
                              <Badge tone="warning">{t("escalatedBadge")}</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("transcript")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!selected ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("selectConvo")}</p>
                    ) : (
                      <div className="space-y-3">
                        {canManage && (
                          <form action={setResolutionAction} className="flex items-center gap-2">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="projectSlug" value={active.slug} />
                            <input type="hidden" name="conversationId" value={selected.id} />
                            <span className="text-sm">{t("resolution")}:</span>
                            <select
                              name="status"
                              defaultValue={selected.status}
                              className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {CHAT_RESOLUTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {t(statusKey[s] ?? "statusOpen")}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="text-sm text-blue-600 hover:underline">
                              ✓
                            </button>
                          </form>
                        )}
                        <ul className="space-y-2">
                          {messages.map((m, i) => (
                            <li
                              // biome-ignore lint/suspicious/noArrayIndexKey: messages are immutable, ordered
                              key={i}
                              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                                  m.role === "user"
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-800"
                                }`}
                              >
                                {m.content}
                                {m.citation && (
                                  <div className="mt-1 text-xs opacity-60">
                                    {t("citation")}: {m.citation.slice(0, 8)}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
