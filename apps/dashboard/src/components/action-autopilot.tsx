import type { ActionProposalView } from "@/lib/action-studio";
import {
  approveActionProposalAction,
  rejectActionProposalAction,
} from "@/lib/actions/action-studio";
import { resolveCtaKind } from "@tracki/shared";
import { Badge, Button } from "@tracki/ui";
import { getTranslations } from "next-intl/server";

/**
 * Tracki Autopilot review queue (slice 12) — server-rendered proposal cards:
 * the evidence that produced the seed, the drafted bilingual copy, and the
 * code-decided targeting summary. Approve creates a *draft* action (a manager
 * then edits/toggles it live in the list); Reject keeps the row for audit.
 */
export async function ActionAutopilot({
  locale,
  orgSlug,
  projectSlug,
  proposals,
  canManage,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
  proposals: ActionProposalView[];
  canManage: boolean;
}) {
  const t = await getTranslations("actions");
  const tStruggle = await getTranslations("struggleTypes");

  if (proposals.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("autopilotEmpty")}</p>;
  }

  return (
    <ul className="space-y-5">
      {proposals.map((p) => {
        const d = p.draft.definition;
        const cta = d.content.ar.cta ?? d.content.en.cta;
        const channel = cta ? resolveCtaKind(cta) : "url";
        return (
          <li key={p.id} className="rounded-xl border border-zinc-200/80 p-4 dark:border-zinc-800">
            {/* Evidence line — why Autopilot proposed this */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold" dir="ltr">
                {p.evidence.path}
              </span>
              <Badge tone="warning">{tStruggle(p.evidence.struggleType as "rage_click")}</Badge>
              <Badge>{t("seenTimes", { count: p.evidence.count })}</Badge>
              <Badge>{t("frictionScore", { score: p.evidence.score })}</Badge>
              {p.evidence.element && (
                <code
                  className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800"
                  dir="ltr"
                >
                  {p.evidence.element}
                </code>
              )}
            </div>
            {p.evidence.gapQuestion && (
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                {t("gapEvidence", { question: p.evidence.gapQuestion })}
              </p>
            )}

            {/* Drafted bilingual copy */}
            <div className="mb-3 grid gap-3 md:grid-cols-2">
              <div dir="rtl" className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <div className="text-sm font-bold">{d.content.ar.title}</div>
                <div className="mt-1 text-sm opacity-80">{d.content.ar.body}</div>
                {d.content.ar.cta && (
                  <span className="mt-2 inline-block rounded-lg bg-blue-600 px-2.5 py-1 text-xs text-white">
                    {d.content.ar.cta.label}
                  </span>
                )}
              </div>
              <div dir="ltr" className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <div className="text-sm font-bold">{d.content.en.title}</div>
                <div className="mt-1 text-sm opacity-80">{d.content.en.body}</div>
                {d.content.en.cta && (
                  <span className="mt-2 inline-block rounded-lg bg-blue-600 px-2.5 py-1 text-xs text-white">
                    {d.content.en.cta.label}
                  </span>
                )}
              </div>
            </div>

            {/* Code-decided targeting summary */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <Badge tone={channel === "whatsapp" ? "success" : "neutral"}>
                {t(`channel_${channel}` as "channel_chat")}
              </Badge>
              <span>
                {t("targetingSummary", {
                  trigger:
                    d.trigger.kind === "struggle"
                      ? tStruggle((d.struggleTypes?.[0] ?? "rage_click") as "rage_click")
                      : tStruggle("rage_click"),
                  url: d.urlContains ?? "—",
                })}
              </span>
              {d.goalEvent && <span>· {t("goalSummary", { goal: d.goalEvent })}</span>}
            </div>

            {canManage && (
              <form action={approveActionProposalAction} className="flex items-center gap-2">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="projectSlug" value={projectSlug} />
                <input type="hidden" name="proposalId" value={p.id} />
                <Button type="submit" size="sm">
                  {t("approveDraft")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  formAction={rejectActionProposalAction}
                >
                  {t("reject")}
                </Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
