"use client";

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { SEV_STYLE, ScoreMeter, StruggleTypeIcon, asSev } from "./struggle-visuals";

interface Struggle {
  struggle_id: string;
  type: string;
  severity: string;
  path: string;
  element?: string;
  reason: string;
  anon_id: string;
  user_id: string;
  score?: number;
  ts?: number | string;
  _new?: boolean;
}

const MAX_ROWS = 100;

export function StruggleFeed({
  orgSlug,
  projectSlug,
  initial,
}: {
  orgSlug: string;
  projectSlug: string;
  initial: Struggle[];
}) {
  const t = useTranslations("struggles");
  const tTypes = useTranslations("struggleTypes");
  const tSev = useTranslations("severity");
  const locale = useLocale();
  const [rows, setRows] = useState<Struggle[]>(initial);
  const [connected, setConnected] = useState(false);
  const seen = useRef<Set<string>>(new Set(initial.map((s) => s.struggle_id)));

  useEffect(() => {
    const es = new EventSource(`/api/orgs/${orgSlug}/projects/${projectSlug}/struggles/live`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const s = JSON.parse(e.data) as Struggle;
        if (seen.current.has(s.struggle_id)) return;
        seen.current.add(s.struggle_id);
        setRows((prev) => [{ ...s, _new: true }, ...prev].slice(0, MAX_ROWS));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [orgSlug, projectSlug]);

  const fmtTime = (ts?: number | string) => {
    if (ts === undefined) return "";
    const d = typeof ts === "number" ? new Date(ts) : new Date(`${ts.replace(" ", "T")}Z`);
    return new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(d);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {connected && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 animate-ping-slow" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? "bg-blue-500" : "bg-amber-500"}`}
            />
          </span>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {t("feedTitle")}
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {connected ? t("live") : t("reconnecting")}
          </span>
        </div>
        {rows.length > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
            <StruggleTypeIcon type="rage_click" width={20} height={20} />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("waiting")}</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((s) => {
            const visitor = s.user_id || s.anon_id;
            const sev = asSev(s.severity);
            const style = SEV_STYLE[sev];
            return (
              <li
                key={s.struggle_id}
                className={`flex items-center gap-3 rounded-xl border border-zinc-100 border-s-2 ${style.border} bg-white px-3 py-2.5 transition-colors hover:bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:bg-zinc-800/40 ${s._new ? "animate-feed-in" : ""}`}
              >
                {/* Type icon */}
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.soft}`}
                >
                  <StruggleTypeIcon type={s.type} width={17} height={17} />
                </div>

                {/* Type + element */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {tTypes.has(s.type) ? tTypes(s.type) : s.type}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${style.soft}`}
                    >
                      {tSev.has(s.severity) ? tSev(s.severity) : s.severity}
                    </span>
                  </div>
                  {s.element ? (
                    <code
                      className="mt-0.5 block truncate text-xs text-zinc-400 dark:text-zinc-500"
                      dir="ltr"
                    >
                      {s.element}
                    </code>
                  ) : null}
                </div>

                {/* Score meter */}
                {typeof s.score === "number" && (
                  <div className="hidden shrink-0 sm:block">
                    <ScoreMeter score={s.score} sev={sev} label={t("scoreLabel")} />
                  </div>
                )}

                {/* Path */}
                <code
                  className="hidden max-w-[10rem] shrink-0 truncate rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 md:block dark:bg-zinc-800 dark:text-zinc-400"
                  dir="ltr"
                >
                  {s.path || "—"}
                </code>

                {/* Visitor */}
                <Link
                  href={`/orgs/${orgSlug}/projects/${projectSlug}/visitors/${encodeURIComponent(visitor)}`}
                  className="hidden shrink-0 truncate font-mono text-xs text-blue-600 hover:underline lg:block dark:text-blue-400"
                  dir="ltr"
                >
                  {visitor.slice(0, 16)}
                </Link>

                {/* Time */}
                <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                  {fmtTime(s.ts)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
