import { clickhouse } from "@/lib/analytics";
import { assistResults } from "@tracki/clickhouse";
import { getTranslations } from "next-intl/server";

/** SSR Live Assist funnel per action (shown / helpful / unhelpful / escalate). */
export async function AssistReport({
  orgId,
  projectId,
  names,
}: {
  orgId: string;
  projectId: string;
  names: Record<string, string>;
}) {
  const t = await getTranslations("actions");

  let rows: Awaited<ReturnType<typeof assistResults>> = [];
  try {
    rows = await assistResults(clickhouse(), orgId, projectId, 30);
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("assistEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="p-2 text-start font-medium">{t("colAction")}</th>
            <th className="p-2 text-start font-medium">{t("assistShown")}</th>
            <th className="p-2 text-start font-medium">{t("assistHelpful")}</th>
            <th className="p-2 text-start font-medium">{t("assistUnhelpful")}</th>
            <th className="p-2 text-start font-medium">{t("assistRate")}</th>
            <th className="p-2 text-start font-medium">{t("assistEscalate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const up = Number(r.helpful);
            const down = Number(r.unhelpful);
            const rate = up + down > 0 ? `${((up / (up + down)) * 100).toFixed(0)}%` : "—";
            return (
              <tr key={r.action_id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="p-2">{names[r.action_id] ?? r.action_id.slice(0, 8)}</td>
                <td className="p-2">{r.shown}</td>
                <td className="p-2">{r.helpful}</td>
                <td className="p-2">{r.unhelpful}</td>
                <td className="p-2">{rate}</td>
                <td className="p-2">{r.escalate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
