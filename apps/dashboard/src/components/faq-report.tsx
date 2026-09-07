import { clickhouse } from "@/lib/analytics";
import { faqReport } from "@tracki/clickhouse";
import { getTranslations } from "next-intl/server";

export async function FaqReportView({ orgId, projectId }: { orgId: string; projectId: string }) {
  const t = await getTranslations("faq");

  let report: Awaited<ReturnType<typeof faqReport>> | null = null;
  try {
    report = await faqReport(clickhouse(), orgId, projectId, 14);
  } catch {
    report = null;
  }

  if (!report) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("reportEmpty")}</p>;
  }

  const { totals, topSearches, topNoResults } = report;
  const stat = (label: string, value: string) => (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );

  const termList = (title: string, rows: { term: string; count: string }[]) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">—</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.term} className="flex justify-between gap-2 text-sm">
              <span className="truncate">{r.term}</span>
              <span className="text-zinc-500">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat(t("views"), totals.views)}
        {stat(t("searches"), totals.searches)}
        {stat(t("noResults"), totals.noResults)}
        {stat(t("helpful"), totals.votesUp)}
        {stat(t("notHelpful"), totals.votesDown)}
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {termList(t("topSearches"), topSearches)}
        {termList(t("topNoResults"), topNoResults)}
      </div>
    </div>
  );
}
