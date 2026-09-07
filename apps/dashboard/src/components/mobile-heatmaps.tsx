import type { MobileInsights } from "@/lib/mobile";
import { getTranslations } from "next-intl/server";

/**
 * Mobile friction heatmaps (slice 14): the screens hurting most (summed
 * friction score), the screens journeys die on, and the screens worth
 * intervening on first (at-risk money × no live action coverage). Money uses
 * the slice-13 honesty rules — AOV unset shows a prompt, never a number.
 */
export async function MobileHeatmaps({
  insights,
  currency,
  locale,
  aovSet,
}: {
  insights: MobileInsights;
  currency: string;
  locale: string;
  aovSet: boolean;
}) {
  const t = await getTranslations("mobile");
  const tStruggle = await getTranslations("struggleTypes");
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const money = (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(
      n,
    );

  const { frictionScreens, abandonment } = insights;
  const maxFriction = Math.max(...frictionScreens.map((s) => s.friction), 1);
  const maxEnded = Math.max(...abandonment.map((a) => a.ended), 1);
  const opportunities = frictionScreens
    .filter((s) => s.uncovered)
    .sort((a, b) => b.atRiskMoney - a.atRiskMoney || b.friction - a.friction)
    .slice(0, 5);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Highest-friction screens */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("frictionScreens")}
        </h3>
        {frictionScreens.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noScreens")}</p>
        ) : (
          frictionScreens.map((s) => (
            <div key={s.path} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-zinc-700 dark:text-zinc-200" dir="ltr">
                  {s.path}
                </span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {tStruggle.has(s.topType) ? tStruggle(s.topType) : s.topType} ·{" "}
                  {t("frictionPoints", { count: num(s.friction) })}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-amber-500 to-rose-500"
                  style={{ inlineSize: `${(s.friction / maxFriction) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </section>

      {/* Highest-abandonment screens */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("abandonmentScreens")}
        </h3>
        {abandonment.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noScreens")}</p>
        ) : (
          abandonment.map((a) => (
            <div key={a.path} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-zinc-700 dark:text-zinc-200" dir="ltr">
                  {a.path}
                </span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {t("endedSessions", { count: num(a.ended) })}
                  {a.abandons > 0 && <> · {t("flowAbandons", { count: num(a.abandons) })}</>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-zinc-400 to-zinc-500 dark:from-zinc-600 dark:to-zinc-500"
                  style={{ inlineSize: `${(a.ended / maxEnded) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </section>

      {/* Intervention opportunities: high friction, no live action covering it */}
      <section className="space-y-3 lg:col-span-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("opportunities")}
        </h3>
        {opportunities.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noOpportunities")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {opportunities.map((s) => (
              <li
                key={s.path}
                className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-500/30 dark:bg-blue-500/10"
              >
                <div
                  className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-200"
                  dir="ltr"
                >
                  {s.path}
                </div>
                <div className="mt-1.5 text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">
                  {aovSet ? money(s.atRiskMoney) : t("frictionPoints", { count: num(s.friction) })}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("noLiveAction")}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("opportunitiesCaption")}</p>
      </section>
    </div>
  );
}
