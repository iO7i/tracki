import { Card } from "@tracki/ui";
import { getTranslations } from "next-intl/server";
import { SEV_STYLE, type Sev } from "./struggle-visuals";

/**
 * Friction overview band: a single hero card with the total struggle volume,
 * a proportional severity distribution bar, and three severity tiles (count +
 * share). Replaces the flat 3-StatCard row. RTL-safe, server-rendered.
 */
export async function StruggleOverview({ counts }: { counts: Record<Sev, number> }) {
  const t = await getTranslations("struggles");
  const tSev = await getTranslations("severity");
  const order: Sev[] = ["high", "medium", "low"];
  const total = order.reduce((n, s) => n + counts[s], 0);
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {t("overviewTitle")}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50">
              {total}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("total")}</span>
          </div>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{t("windowHint")}</span>
      </div>

      {/* Proportional distribution bar */}
      <div className="px-5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          {total === 0
            ? null
            : order.map((s) =>
                counts[s] === 0 ? null : (
                  <div
                    key={s}
                    className={`h-full ${SEV_STYLE[s].bar} first:rounded-s-full last:rounded-e-full`}
                    style={{ inlineSize: `${pct(counts[s])}%` }}
                    title={`${tSev(s)} · ${counts[s]}`}
                  />
                ),
              )}
        </div>
      </div>

      {/* Severity tiles */}
      <div className="grid grid-cols-3 gap-px border-t border-zinc-100 bg-zinc-100 mt-5 dark:border-zinc-800 dark:bg-zinc-800">
        {order.map((s) => (
          <div key={s} className="bg-white p-4 dark:bg-zinc-900/70">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${SEV_STYLE[s].bar}`} />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {tSev(s)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold tracking-tight tabular-nums ${SEV_STYLE[s].text}`}
              >
                {counts[s]}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                {pct(counts[s])}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
