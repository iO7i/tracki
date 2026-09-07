import { Link } from "@/i18n/navigation";
import { clickhouse } from "@/lib/analytics";
import {
  dailyStruggleReport,
  frictionByPath,
  topStruggleElements,
  topStruggleVisitors,
} from "@tracki/clickhouse";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { StruggleTypeIcon } from "./struggle-visuals";

/**
 * SSR rich struggle report (slice 11): counts by type, paths ranked by summed
 * friction score, the elements causing the most pain, and the most-struggling
 * visitors. CSS bars, RTL-safe (logical properties). Visual refresh: section
 * panels, type icons, rank badges, gradient bars, visitor avatars.
 */

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function initials(s: string): string {
  const clean = s.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(0, 2) || "··").toUpperCase();
}

export async function StruggleReport({
  orgSlug,
  projectSlug,
  orgId,
  projectId,
}: {
  orgSlug: string;
  projectSlug: string;
  orgId: string;
  projectId: string;
}) {
  const t = await getTranslations("struggles");
  const tTypes = await getTranslations("struggleTypes");

  let daily: Awaited<ReturnType<typeof dailyStruggleReport>> = [];
  let paths: Awaited<ReturnType<typeof frictionByPath>> = [];
  let elements: Awaited<ReturnType<typeof topStruggleElements>> = [];
  let visitors: Awaited<ReturnType<typeof topStruggleVisitors>> = [];
  try {
    const ch = clickhouse();
    [daily, paths, elements, visitors] = await Promise.all([
      dailyStruggleReport(ch, orgId, projectId, 14),
      frictionByPath(ch, orgId, projectId, 14, 8),
      topStruggleElements(ch, orgId, projectId, 14, 8),
      topStruggleVisitors(ch, orgId, projectId, 14, 8),
    ]);
  } catch {
    /* empty */
  }

  if (daily.length === 0 && paths.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("reportEmpty")}</p>;
  }

  const byType = new Map<string, number>();
  for (const r of daily) byType.set(r.type, (byType.get(r.type) ?? 0) + Number(r.count));
  const typeRows = [...byType.entries()].sort(([, a], [, b]) => b - a);
  const typeMax = Math.max(...typeRows.map(([, c]) => c), 1);
  const frictionMax = Math.max(...paths.map((p) => Number(p.friction)), 1);
  const elemMax = Math.max(...elements.map((e) => Number(e.count)), 1);
  const visitorMax = Math.max(...visitors.map((v) => Number(v.count)), 1);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* By type */}
      <Panel title={t("byType")}>
        <div className="space-y-3">
          {typeRows.map(([type, count]) => (
            <div key={type} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
                  <StruggleTypeIcon
                    type={type}
                    width={14}
                    height={14}
                    className="text-zinc-400 dark:text-zinc-500"
                  />
                  {tTypes.has(type) ? tTypes(type) : type}
                </span>
                <span className="font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                  {count}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-blue-400"
                  style={{ inlineSize: `${(count / typeMax) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Friction paths — ranked by summed score */}
      <Panel title={t("frictionPaths")}>
        {paths.length === 0 ? (
          <p className="text-xs text-zinc-400">{t("reportEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {paths.map((p, i) => (
              <div key={p.path} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-200 text-[10px] font-bold tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {i + 1}
                    </span>
                    <span className="truncate font-mono text-zinc-700 dark:text-zinc-200" dir="ltr">
                      {p.path || "—"}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-500">
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {p.friction}
                    </span>{" "}
                    · {p.count}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
                    style={{ inlineSize: `${(Number(p.friction) / frictionMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Top elements */}
      <Panel title={t("topElements")}>
        {elements.length === 0 ? (
          <p className="text-xs text-zinc-400">{t("reportEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {elements.map((e) => (
              <div key={e.element} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <code className="truncate text-zinc-700 dark:text-zinc-200" dir="ltr">
                    {e.element}
                  </code>
                  <span className="flex shrink-0 items-center gap-1.5 text-zinc-500">
                    <StruggleTypeIcon
                      type={e.top_type}
                      width={13}
                      height={13}
                      className="text-zinc-400 dark:text-zinc-500"
                    />
                    {tTypes.has(e.top_type) ? tTypes(e.top_type) : e.top_type} ·{" "}
                    <span className="font-semibold tabular-nums">{e.count}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-rose-500 to-rose-400"
                    style={{ inlineSize: `${(Number(e.count) / elemMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Top struggling visitors */}
      <Panel title={t("topVisitors")}>
        {visitors.length === 0 ? (
          <p className="text-xs text-zinc-400">{t("reportEmpty")}</p>
        ) : (
          <ul className="space-y-1">
            {visitors.map((v) => {
              const width = (Number(v.count) / visitorMax) * 100;
              return (
                <li key={v.visitor}>
                  <Link
                    href={`/orgs/${orgSlug}/projects/${projectSlug}/visitors/${encodeURIComponent(v.visitor)}`}
                    className="group relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 hover:bg-white dark:hover:bg-zinc-800/60"
                  >
                    {/* faint volume bar behind the row */}
                    <span
                      className="pointer-events-none absolute inset-y-0 start-0 bg-sky-500/5 dark:bg-sky-400/5"
                      style={{ inlineSize: `${width}%` }}
                    />
                    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                      {initials(v.visitor)}
                    </span>
                    <span
                      className="relative min-w-0 flex-1 truncate font-mono text-xs text-blue-600 group-hover:underline dark:text-blue-400"
                      dir="ltr"
                    >
                      {v.visitor.slice(0, 24)}
                    </span>
                    <span className="relative shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {v.count}{" "}
                      <span className="text-zinc-400 dark:text-zinc-500">
                        · {t("maxScore")} {v.max_score}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
