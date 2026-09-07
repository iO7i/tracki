import type { MobileRevenueInsights } from "@/lib/mobile";
import { getTranslations } from "next-intl/server";

/**
 * Revenue cuts added by implementation: recovery by struggle type, by app version
 * and by device platform — the same sessionized recovered/at-risk split as the
 * implementation hero, labeled correlation-not-causation. AOV unset ⇒ counts only.
 */
export async function MobileRevenuePanels({
  insights,
  currency,
  locale,
  aovSet,
}: {
  insights: MobileRevenueInsights;
  currency: string;
  locale: string;
  aovSet: boolean;
}) {
  const t = await getTranslations("revenue");
  const tStruggle = await getTranslations("struggleTypes");
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const money = (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(
      n,
    );

  const { byStruggleType, byAppVersion, byPlatform } = insights;
  if (byStruggleType.length === 0 && byAppVersion.length === 0 && byPlatform.length === 0) {
    return null;
  }

  const platformLabel = (dim: string) =>
    dim === "" ? t("dimWebLegacy") : dim === "web" ? t("dimWeb") : dim;

  const table = (
    rows: Array<{
      key: string;
      label: string;
      atRisk: number;
      recovered: number;
      atRiskMoney: number;
      recoveredMoney: number;
    }>,
    firstCol: string,
  ) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 pe-3 text-start font-medium">{firstCol}</th>
            <th className="py-2 pe-3 text-start font-medium">{t("atRisk")}</th>
            <th className="py-2 text-start font-medium">{t("recovered")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
            >
              <td className="py-2 pe-3 text-xs">{r.label}</td>
              <td className="py-2 pe-3 tabular-nums text-xs">
                {aovSet && (
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {money(r.atRiskMoney)}
                  </span>
                )}{" "}
                <span className="text-zinc-500">
                  · {t("atRiskSessions", { count: num(r.atRisk) })}
                </span>
              </td>
              <td className="py-2 tabular-nums text-xs">
                {aovSet && (
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {money(r.recoveredMoney)}
                  </span>
                )}{" "}
                <span className="text-zinc-500">
                  · {t("recoveredSessions", { count: num(r.recovered) })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {byStruggleType.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("byStruggleType")}
          </h3>
          {table(
            byStruggleType.map((r) => ({
              key: r.type,
              label: tStruggle.has(r.type) ? tStruggle(r.type) : r.type,
              ...r,
            })),
            t("colStruggleType"),
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {byPlatform.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("byPlatform")}
            </h3>
            {table(
              byPlatform.map((r) => ({
                key: r.dim || "legacy",
                label: platformLabel(r.dim),
                ...r,
              })),
              t("colPlatform"),
            )}
          </section>
        )}
        {byAppVersion.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("byAppVersion")}
            </h3>
            {table(
              byAppVersion.map((r) => ({
                key: r.dim || "none",
                label: r.dim || t("dimNoVersion"),
                ...r,
              })),
              t("colAppVersion"),
            )}
          </section>
        )}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("dimensionsCaption")}</p>
    </div>
  );
}
