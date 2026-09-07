import { clickhouse } from "@/lib/analytics";
import { actionResults } from "@tracki/clickhouse";
import { getTranslations } from "next-intl/server";

/** SSR per-action × variant results table from ClickHouse. */
export async function ActionResults({
  orgId,
  projectId,
  names,
}: {
  orgId: string;
  projectId: string;
  names: Record<string, string>;
}) {
  const t = await getTranslations("actions");

  let rows: Awaited<ReturnType<typeof actionResults>> = [];
  try {
    rows = await actionResults(clickhouse(), orgId, projectId, 30);
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("resultsEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="p-2 text-start font-medium">{t("colAction")}</th>
            <th className="p-2 text-start font-medium">{t("colVariant")}</th>
            <th className="p-2 text-start font-medium">{t("colImpressions")}</th>
            <th className="p-2 text-start font-medium">{t("colClicks")}</th>
            <th className="p-2 text-start font-medium">{t("colCtr")}</th>
            <th className="p-2 text-start font-medium">{t("colDismiss")}</th>
            <th className="p-2 text-start font-medium">{t("colGoals")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const imp = Number(r.impressions);
            const clk = Number(r.clicks);
            const ctr = imp > 0 ? `${((clk / imp) * 100).toFixed(1)}%` : "—";
            return (
              <tr
                key={`${r.action_id}-${r.variant}`}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="p-2">{names[r.action_id] ?? r.action_id.slice(0, 8)}</td>
                <td className="p-2">{r.variant || "A"}</td>
                <td className="p-2">{r.impressions}</td>
                <td className="p-2">{r.clicks}</td>
                <td className="p-2">{ctr}</td>
                <td className="p-2">{r.dismisses}</td>
                <td className="p-2">{r.goals}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
