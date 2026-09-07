import { clickhouse } from "@/lib/analytics";
import { dailyVolume } from "@tracki/clickhouse";
import { getTranslations } from "next-intl/server";

/**
 * Server component: 14-day event-volume bar chart from ClickHouse. Pure
 * SSR + CSS bars (no client charting dep). RTL-safe (logical properties).
 */
export async function VolumeChart({ orgId, projectId }: { orgId: string; projectId: string }) {
  const t = await getTranslations("chart");

  let rows: Awaited<ReturnType<typeof dailyVolume>> = [];
  try {
    rows = await dailyVolume(clickhouse(), orgId, projectId, 14);
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>;
  }

  // Aggregate by day across types.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.count));
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(...days.map(([, c]) => c), 1);
  const total = days.reduce((sum, [, c]) => sum + c, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {t("total")}: {total.toLocaleString()} {t("events")}
      </p>
      <div className="flex h-40 items-end gap-1">
        {days.map(([day, count]) => (
          <div
            key={day}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${day}: ${count}`}
          >
            <div
              className="w-full rounded-t bg-blue-500/80"
              style={{ height: `${Math.max((count / max) * 100, 2)}%` }}
            />
            <span className="text-[10px] text-zinc-400" dir="ltr">
              {day.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
