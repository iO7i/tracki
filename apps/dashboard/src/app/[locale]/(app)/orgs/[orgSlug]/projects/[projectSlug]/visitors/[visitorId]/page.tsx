import { db } from "@/db";
import { identities, projects } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { clickhouse } from "@/lib/analytics";
import { requireProject } from "@/lib/tenancy";
import { type SessionJourneyRow, visitorSessions, visitorTimeline } from "@tracki/clickhouse";
import { journeyScore } from "@tracki/shared";
import { Badge, Card, CardContent } from "@tracki/ui";
import { and, eq } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";

/** Small per-event hint from masked props (durations, flow names, outcomes). */
function propsHint(type: string, props: string): string {
  try {
    const p = JSON.parse(props) as Record<string, unknown>;
    if (type === "screen_leave" && typeof p.durationMs === "number") {
      return `${Math.round(p.durationMs / 1000)}s`;
    }
    if (type.startsWith("flow_") && typeof p.flow === "string") return p.flow.slice(0, 24);
    if (type === "permission_denied" && typeof p.permission === "string") {
      return p.permission.slice(0, 24);
    }
    if (type === "deep_link" && p.ok === false) return "✕";
    if (type === "app_foreground" && typeof p.launch === "string") return p.launch;
    if (type === "track" && typeof p.name === "string") return p.name.slice(0, 24);
  } catch {
    /* unparseable props → no hint */
  }
  return "";
}

export default async function VisitorPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string; projectSlug: string; visitorId: string }>;
}) {
  const { locale, orgSlug, projectSlug, visitorId: raw } = await params;
  const visitorId = decodeURIComponent(raw);
  const { org, project } = await requireProject(locale, orgSlug, projectSlug);
  const t = await getTranslations("timeline");
  const tTypes = await getTranslations("eventTypes");
  const format = await getFormatter();

  // Identity merge: collect every anon_id tied to this visitor. The id may be a
  // user_id (look up its anon_ids) or an anon_id (look up its mapped user, then
  // that user's other anon_ids).
  const asUser = await db
    .select({ anonId: identities.anonId, userId: identities.userId })
    .from(identities)
    .where(and(eq(identities.projectId, project.id), eq(identities.userId, visitorId)));

  let userId: string | null = asUser.length > 0 ? visitorId : null;
  const anonIds = new Set<string>([visitorId, ...asUser.map((r) => r.anonId)]);

  if (!userId) {
    const asAnon = await db
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(eq(identities.projectId, project.id), eq(identities.anonId, visitorId)))
      .limit(1);
    if (asAnon[0]) {
      userId = asAnon[0].userId;
      const siblings = await db
        .select({ anonId: identities.anonId })
        .from(identities)
        .where(and(eq(identities.projectId, project.id), eq(identities.userId, userId)));
      for (const s of siblings) anonIds.add(s.anonId);
    }
  }

  // Slice 14: journey reconstruction — events grouped by session with a
  // per-session header (device, journey score, conversion). The conversion
  // event name comes from the project's revenue settings.
  const [projRow] = await db
    .select({ conversionEvent: projects.conversionEvent })
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);

  let rows: Awaited<ReturnType<typeof visitorTimeline>> = [];
  let sessions: SessionJourneyRow[] = [];
  try {
    [rows, sessions] = await Promise.all([
      visitorTimeline(clickhouse(), org.id, project.id, [...anonIds], userId),
      visitorSessions(
        clickhouse(),
        org.id,
        project.id,
        [...anonIds],
        userId,
        projRow?.conversionEvent ?? "purchase",
      ),
    ]);
  } catch {
    rows = [];
    sessions = [];
  }

  const sessionInfo = new Map(sessions.map((s) => [s.session_id, s]));
  // Preserve chronological order (rows are ts ASC) while grouping by session.
  const grouped: Array<{ sessionId: string; events: typeof rows }> = [];
  for (const ev of rows) {
    const last = grouped[grouped.length - 1];
    if (last && last.sessionId === ev.session_id) last.events.push(ev);
    else grouped.push({ sessionId: ev.session_id, events: [ev] });
  }
  const scoreFor = (s: SessionJourneyRow | undefined) =>
    s
      ? journeyScore({
          struggleScoreSum: Number(s.friction),
          flowsAbandoned: Number(s.abandoned_flows),
          flowsCompleted: Number(s.completed_flows),
          converted: s.converted === "1",
        }).score
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={{ pathname: `/orgs/${orgSlug}/live`, query: { project: projectSlug } }}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {userId ? (
            <>
              <Badge tone="success">
                {t("userId")}: <span dir="ltr">{userId}</span>
              </Badge>
              <span className="text-zinc-500 dark:text-zinc-400">{t("merged")}</span>
            </>
          ) : (
            <Badge>
              {t("anonId")}: <span dir="ltr">{visitorId.slice(0, 24)}</span>
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("empty")}
            </p>
          ) : (
            <div className="space-y-6">
              {grouped.map((g, idx) => {
                const info = sessionInfo.get(g.sessionId);
                const score = scoreFor(info);
                const isMobile = info?.plat === "ios" || info?.plat === "android";
                return (
                  <section key={g.sessionId} className="space-y-2">
                    {/* Session header (slice 14 journey reconstruction). */}
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900/60">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                        {t("session", { n: idx + 1 })}
                      </span>
                      {isMobile && (
                        <Badge>
                          {info?.plat}
                          {info?.app_ver ? ` ${info.app_ver}` : ""}
                        </Badge>
                      )}
                      {score !== null && (
                        <span
                          className={[
                            "rounded px-1.5 py-0.5 font-bold tabular-nums",
                            score >= 70
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : score >= 40
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                          ].join(" ")}
                          title={t("journeyScore")}
                        >
                          {format.number(score)}
                        </span>
                      )}
                      {info && Number(info.struggle_count) > 0 && (
                        <Badge tone="warning">
                          {t("sessionStruggles", {
                            count: format.number(Number(info.struggle_count)),
                          })}
                        </Badge>
                      )}
                      {info?.converted === "1" && <Badge tone="success">{t("converted")}</Badge>}
                    </div>

                    <ol className="space-y-2">
                      {g.events.map((ev) => {
                        const hint = propsHint(ev.type, ev.props);
                        return (
                          <li
                            key={ev.event_id}
                            className="flex items-center gap-3 border-s-2 border-blue-500/40 ps-3"
                          >
                            <Badge
                              tone={
                                ev.type === "error" ||
                                ev.type.endsWith("_fail") ||
                                ev.type === "flow_abandon" ||
                                ev.type === "permission_denied"
                                  ? "warning"
                                  : "neutral"
                              }
                            >
                              {tTypes.has(ev.type) ? tTypes(ev.type) : ev.type}
                            </Badge>
                            <span className="flex-1 truncate font-mono text-xs" dir="ltr">
                              {ev.path || "—"}
                              {hint && <span className="text-zinc-400"> · {hint}</span>}
                            </span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {format.dateTime(new Date(`${ev.ts.replace(" ", "T")}Z`), {
                                dateStyle: "short",
                                timeStyle: "medium",
                              })}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
