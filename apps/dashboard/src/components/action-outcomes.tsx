import { clickhouse } from "@/lib/analytics";
import { actionChannelClicks, actionOutcomes } from "@tracki/clickhouse";
import { getTranslations } from "next-intl/server";

const CHANNELS = ["url", "faq", "chat", "whatsapp"] as const;

/**
 * Slice 12 — Outcomes: per action, sessions that struggled before seeing it and
 * how many recovered (no further struggle, or the goal fired), plus the channel
 * split of clicks. Correlation, not causation — labeled honestly in the caption.
 */
export async function ActionOutcomes({
  orgId,
  projectId,
  names,
}: {
  orgId: string;
  projectId: string;
  names: Record<string, string>;
}) {
  const t = await getTranslations("actions");

  let outcomes: Awaited<ReturnType<typeof actionOutcomes>> = [];
  let channels: Awaited<ReturnType<typeof actionChannelClicks>> = [];
  try {
    [outcomes, channels] = await Promise.all([
      actionOutcomes(clickhouse(), orgId, projectId, 30),
      actionChannelClicks(clickhouse(), orgId, projectId, 30),
    ]);
  } catch {
    outcomes = [];
    channels = [];
  }

  if (outcomes.length === 0 && channels.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("outcomesEmpty")}</p>;
  }

  // Channel clicks per action, keyed for the chips column.
  const byAction = new Map<string, { channel: string; clicks: number }[]>();
  for (const c of channels) {
    const list = byAction.get(c.action_id) ?? [];
    list.push({ channel: c.channel, clicks: Number(c.clicks) });
    byAction.set(c.action_id, list);
  }
  const actionIds = [...new Set([...outcomes.map((o) => o.action_id), ...byAction.keys()])];
  const outcomeFor = new Map(outcomes.map((o) => [o.action_id, o]));
  const channelLabel = (c: string) =>
    (CHANNELS as readonly string[]).includes(c) ? t(`channel_${c as "url"}`) : t("channelLegacy");

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="p-2 text-start font-medium">{t("colAction")}</th>
              <th className="p-2 text-start font-medium">{t("colStruggled")}</th>
              <th className="p-2 text-start font-medium">{t("colRecovered")}</th>
              <th className="p-2 text-start font-medium">{t("colRecoveryRate")}</th>
              <th className="p-2 text-start font-medium">{t("colChannels")}</th>
            </tr>
          </thead>
          <tbody>
            {actionIds.map((id) => {
              const o = outcomeFor.get(id);
              const struggled = Number(o?.struggled_sessions ?? 0);
              const recovered = Number(o?.recovered_sessions ?? 0);
              const rate = struggled > 0 ? `${((recovered / struggled) * 100).toFixed(0)}%` : "—";
              const chips = (byAction.get(id) ?? []).filter((c) => c.clicks > 0);
              return (
                <tr key={id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="p-2">{names[id] ?? id.slice(0, 8)}</td>
                  <td className="p-2">{struggled || "—"}</td>
                  <td className="p-2">{recovered || (struggled ? "0" : "—")}</td>
                  <td className="p-2">{rate}</td>
                  <td className="p-2">
                    {chips.length === 0 ? (
                      "—"
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                          <span
                            key={c.channel}
                            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
                          >
                            {channelLabel(c.channel)} · {c.clicks}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("outcomesCaption")}</p>
    </div>
  );
}
