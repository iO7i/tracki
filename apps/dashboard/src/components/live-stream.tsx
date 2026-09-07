"use client";

import { Link } from "@/i18n/navigation";
import { Badge } from "@tracki/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

interface LiveEvent {
  event_id: string;
  type: string;
  path: string;
  anon_id: string;
  user_id: string;
  session_id: string;
  // Coarse surface label ('web' | 'ios' | 'android'; absent on legacy frames) — 00-14 N2.
  platform?: string;
  // Published from ingest as epoch ms.
  ts?: number;
}

const MAX_ROWS = 100;

export function LiveStream({
  orgSlug,
  projectSlug,
}: {
  orgSlug: string;
  projectSlug: string;
}) {
  const t = useTranslations("live");
  const tTypes = useTranslations("eventTypes");
  const locale = useLocale();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const url = `/api/orgs/${orgSlug}/projects/${projectSlug}/live`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as LiveEvent;
        if (seen.current.has(ev.event_id)) return;
        seen.current.add(ev.event_id);
        setEvents((prev) => [ev, ...prev].slice(0, MAX_ROWS));
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
  }, [orgSlug, projectSlug]);

  const fmtTime = (ts?: number) => {
    if (!ts) return "";
    return new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(new Date(ts));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-blue-500" : "bg-amber-500"}`}
        />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {connected ? t("connected") : t("disconnected")}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">{t("waiting")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-start text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="p-2 text-start font-medium">{t("colType")}</th>
                <th className="p-2 text-start font-medium">{t("colPath")}</th>
                <th className="p-2 text-start font-medium">{t("colVisitor")}</th>
                <th className="p-2 text-start font-medium">{t("colTime")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const visitor = ev.user_id || ev.anon_id;
                return (
                  <tr key={ev.event_id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="p-2">
                      <Badge tone={ev.type === "error" ? "warning" : "neutral"}>
                        {tTypes.has(ev.type) ? tTypes(ev.type) : ev.type}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs" dir="ltr">
                      {ev.path || "—"}
                      {/* Mobile events are labeled; web stays unadorned (00-14 N2). */}
                      {(ev.platform === "ios" || ev.platform === "android") && (
                        <span className="ms-1.5 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {ev.platform}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <Link
                        href={`/orgs/${orgSlug}/projects/${projectSlug}/visitors/${encodeURIComponent(visitor)}`}
                        className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        dir="ltr"
                      >
                        {visitor.slice(0, 20)}
                      </Link>
                    </td>
                    <td className="p-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {fmtTime(ev.ts)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
