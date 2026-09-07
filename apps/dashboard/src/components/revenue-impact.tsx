import type { RevenueInsights } from "@/lib/revenue";
import { getTranslations } from "next-intl/server";

/**
 * Revenue Impact view (implementation): the money hero (at-risk / recovered / recovery
 * rate) + the top money-losing high-intent paths. Money = measured sessions ×
 * the merchant AOV; correlation, labeled honestly. AOV unset ⇒ a prompt, never
 * a fabricated figure. Money formatted in the active locale's currency.
 */
export async function RevenueImpactView({
  insights,
  currency,
  locale,
  aovSet,
  days = 30,
}: {
  insights: RevenueInsights;
  currency: string;
  locale: string;
  aovSet: boolean;
  days?: number;
}) {
  const t = await getTranslations("revenue");
  const { counts, impact, paths } = insights;
  const money = (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(
      n,
    );
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const pct = Math.round(impact.recoveryRate * 100);
  const maxMoney = Math.max(...paths.map((p) => p.atRiskMoney), 1);

  if (counts.struggling === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noFriction", { days })}</p>;
  }

  return (
    <div className="space-y-6">
      {!aovSet && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          {t("setAovPrompt")}
        </div>
      )}

      {/* Money hero */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 dark:border-rose-500/30 dark:bg-rose-500/10">
          <div className="text-xs font-medium uppercase tracking-wide text-rose-500 dark:text-rose-300">
            {t("atRisk")}
          </div>
          <div className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums text-rose-600 dark:text-rose-300">
            {aovSet ? money(impact.atRiskMoney) : "—"}
          </div>
          <div className="mt-1 text-xs text-rose-500/80 dark:text-rose-300/70">
            {t("atRiskSessions", { count: num(counts.atRisk) })}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
            {t("recovered")}
          </div>
          <div className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-300">
            {aovSet ? money(impact.recoveredMoney) : "—"}
          </div>
          <div className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-300/70">
            {t("recoveredSessions", { count: num(counts.recovered) })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/70">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {t("recoveryRate")}
          </div>
          <div className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50">
            {num(pct)}%
          </div>
          <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            {t("strugglingSessions", { count: num(counts.struggling) })}
          </div>
        </div>
      </div>

      {/* Top money-losing paths */}
      {paths.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("topPaths")}
          </h3>
          {paths.map((p) => (
            <div key={p.path} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-zinc-700 dark:text-zinc-200" dir="ltr">
                  {p.path || "—"}
                </span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {aovSet && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {money(p.atRiskMoney)}
                    </span>
                  )}{" "}
                  · {t("atRiskSessions", { count: num(p.atRisk) })}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-rose-500 to-rose-400"
                  style={{ inlineSize: `${(p.atRiskMoney / maxMoney) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("caption", { days })}</p>
    </div>
  );
}
