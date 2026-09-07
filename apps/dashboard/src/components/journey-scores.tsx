import { Link } from "@/i18n/navigation";
import type { SessionJourneyView } from "@/lib/mobile";
import { Badge } from "@tracki/ui";
import { getFormatter, getTranslations } from "next-intl/server";

function scoreTone(score: number): string {
  if (score >= 70) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (score >= 40) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
}

/**
 * Mobile journey scores (slice 14): every recent session gets a deterministic
 * 0–100 health score derived from measured friction + funnel signals — a
 * heuristic estimate, labeled as such, never a fabricated "prediction".
 */
export async function JourneyScores({
  journeys,
  orgSlug,
  projectSlug,
}: {
  journeys: SessionJourneyView[];
  orgSlug: string;
  projectSlug: string;
}) {
  const t = await getTranslations("mobile");
  const format = await getFormatter();
  const num = (n: number) => format.number(n);

  if (journeys.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noJourneys")}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-start text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-2 pe-3 text-start font-medium">{t("colScore")}</th>
              <th className="py-2 pe-3 text-start font-medium">{t("colVisitor")}</th>
              <th className="py-2 pe-3 text-start font-medium">{t("colDevice")}</th>
              <th className="py-2 pe-3 text-start font-medium">{t("colScreens")}</th>
              <th className="py-2 pe-3 text-start font-medium">{t("colStruggles")}</th>
              <th className="py-2 pe-3 text-start font-medium">{t("colCompletion")}</th>
              <th className="py-2 text-start font-medium">{t("colOutcome")}</th>
            </tr>
          </thead>
          <tbody>
            {journeys.map((j) => (
              <tr
                key={j.sessionId}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
              >
                <td className="py-2 pe-3">
                  <span
                    className={`inline-flex h-8 w-12 items-center justify-center rounded-lg text-sm font-bold tabular-nums ${scoreTone(j.score.score)}`}
                  >
                    {num(j.score.score)}
                  </span>
                </td>
                <td className="py-2 pe-3">
                  <Link
                    href={`/orgs/${orgSlug}/projects/${projectSlug}/visitors/${encodeURIComponent(j.visitor)}`}
                    className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                    dir="ltr"
                  >
                    {j.visitor.slice(0, 18)}
                  </Link>
                </td>
                <td className="py-2 pe-3 text-xs text-zinc-600 dark:text-zinc-300">
                  {j.platform || "—"}
                  {j.appVersion && (
                    <span className="text-zinc-400 dark:text-zinc-500" dir="ltr">
                      {" "}
                      {j.appVersion}
                    </span>
                  )}
                </td>
                <td className="py-2 pe-3 tabular-nums text-xs">{num(j.screens)}</td>
                <td className="py-2 pe-3 tabular-nums text-xs">
                  {j.struggles > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400">{num(j.struggles)}</span>
                  ) : (
                    num(0)
                  )}
                </td>
                <td className="py-2 pe-3 tabular-nums text-xs text-zinc-500 dark:text-zinc-400">
                  {format.number(j.score.completionProbability, {
                    style: "percent",
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="py-2">
                  {j.converted ? (
                    <Badge tone="success">{t("converted")}</Badge>
                  ) : j.abandonedFlows > 0 ? (
                    <Badge tone="warning">{t("abandoned")}</Badge>
                  ) : (
                    <Badge>{t("browsing")}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("scoreCaption")}</p>
    </div>
  );
}
