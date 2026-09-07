import { PageHeader } from "@/components/page-header";
import { ProjectTabs } from "@/components/project-tabs";
import { WaReplyForm } from "@/components/wa-reply-form";
import { db } from "@/db";
import { handoffs, projects, waConversations, waMessages } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { toggleTakeoverAction } from "@/lib/actions/inbox";
import { requireMembership } from "@/lib/tenancy";
import type { HandoffContext } from "@tracki/shared";
import { MANAGER_ROLES } from "@tracki/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { and, desc, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";

function maskWaId(waId: string): string {
  return waId.length > 4 ? `•••• ${waId.slice(-4)}` : waId;
}

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
  searchParams: Promise<{ project?: string; c?: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const { project: selectedSlug, c: convoId } = await searchParams;
  const t = await getTranslations("inbox");
  const format = await getFormatter();
  const canManage = MANAGER_ROLES.includes(role);

  const orgProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.orgId, org.id));
  const active = orgProjects.find((p) => p.slug === selectedSlug) ?? orgProjects[0] ?? null;

  const convos = active
    ? await db
        .select({
          id: waConversations.id,
          waId: waConversations.waId,
          language: waConversations.language,
          status: waConversations.status,
          takeover: waConversations.takeover,
          handoffId: waConversations.handoffId,
          lastAt: waConversations.lastAt,
        })
        .from(waConversations)
        .where(eq(waConversations.projectId, active.id))
        .orderBy(desc(waConversations.lastAt))
        .limit(100)
    : [];

  const selected = convoId ? convos.find((c) => c.id === convoId) : undefined;
  const messages = selected
    ? await db
        .select({
          direction: waMessages.direction,
          author: waMessages.author,
          content: waMessages.content,
          status: waMessages.status,
        })
        .from(waMessages)
        .where(eq(waMessages.conversationId, selected.id))
        .orderBy(waMessages.createdAt)
    : [];
  // Audit N4: scope the handoff read by project too (not just by id).
  const handoffRow =
    selected?.handoffId && active
      ? (
          await db
            .select({ context: handoffs.context, anonId: handoffs.anonId })
            .from(handoffs)
            .where(and(eq(handoffs.id, selected.handoffId), eq(handoffs.projectId, active.id)))
            .limit(1)
        )[0]
      : undefined;
  const context = handoffRow?.context as HandoffContext | undefined;

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
            basePath={`/orgs/${orgSlug}/inbox`}
          />

          {active && (
            <div className="grid gap-4 lg:grid-cols-3">
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
                        <li key={c.id} className="py-2">
                          <Link
                            href={{
                              pathname: `/orgs/${orgSlug}/inbox`,
                              query: { project: active.slug, c: c.id },
                            }}
                            className={`flex items-center justify-between gap-2 text-sm hover:underline ${
                              selected?.id === c.id ? "font-semibold text-blue-600" : ""
                            }`}
                          >
                            <span dir="ltr">{maskWaId(c.waId)}</span>
                            <span className="flex items-center gap-1">
                              <Badge>{c.language.toUpperCase()}</Badge>
                              {c.takeover === "true" && <Badge tone="warning">👤</Badge>}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{selected ? maskWaId(selected.waId) : t("selectConvo")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {!selected ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("selectConvo")}</p>
                  ) : (
                    <div className="space-y-4">
                      {/* Context panel — the visitor's web context, no repetition. */}
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/40 dark:bg-blue-900/10">
                        <div className="mb-1 font-semibold">{t("context")}</div>
                        {context ? (
                          <ul className="space-y-1 text-xs">
                            {context.path && (
                              <li>
                                <span className="opacity-60">{t("page")}:</span>{" "}
                                <span dir="ltr">{context.path}</span>
                              </li>
                            )}
                            {/* Surface label (00-14 N2): where the customer was stuck. */}
                            {context.platform && (
                              <li>
                                <span className="opacity-60">{t("platform")}:</span>{" "}
                                <span dir="ltr">{context.platform}</span>
                              </li>
                            )}
                            {context.struggle && (
                              <li>
                                <span className="opacity-60">{t("struggle")}:</span>{" "}
                                {context.struggle}
                              </li>
                            )}
                            {context.agentSummary && (
                              <li>
                                <span className="opacity-60">{t("agentSummary")}:</span>{" "}
                                {context.agentSummary}
                              </li>
                            )}
                            {handoffRow?.anonId && active && (
                              <li>
                                <Link
                                  href={`/orgs/${orgSlug}/projects/${active.slug}/visitors/${encodeURIComponent(handoffRow.anonId)}`}
                                  className="text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {t("viewTimeline")} →
                                </Link>
                              </li>
                            )}
                          </ul>
                        ) : (
                          <p className="text-xs opacity-60">{t("noContext")}</p>
                        )}
                      </div>

                      {/* Thread */}
                      <ul className="max-h-80 space-y-2 overflow-auto">
                        {messages.map((m, i) => (
                          <li
                            // biome-ignore lint/suspicious/noArrayIndexKey: ordered immutable messages
                            key={i}
                            className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                                m.direction === "inbound"
                                  ? "bg-zinc-100 dark:bg-zinc-800"
                                  : m.author === "agent"
                                    ? "bg-blue-100 dark:bg-blue-900/40"
                                    : "bg-blue-600 text-white"
                              }`}
                            >
                              <div className="mb-0.5 text-[10px] opacity-60">
                                {t(`${m.author}Badge` as "agentBadge")}
                              </div>
                              {m.content}
                              {m.direction === "outbound" && m.status === "failed" && (
                                <div className="mt-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                  ⚠ {t("notDelivered")}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>

                      {canManage && (
                        <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                          <form action={toggleTakeoverAction}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="projectSlug" value={active.slug} />
                            <input type="hidden" name="conversationId" value={selected.id} />
                            <input
                              type="hidden"
                              name="next"
                              value={selected.takeover === "true" ? "false" : "true"}
                            />
                            <button
                              type="submit"
                              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {selected.takeover === "true" ? t("takeoverOff") : t("takeoverOn")}
                            </button>
                          </form>
                          <WaReplyForm
                            locale={locale}
                            orgSlug={orgSlug}
                            projectSlug={active.slug}
                            conversationId={selected.id}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
