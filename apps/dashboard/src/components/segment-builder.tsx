"use client";

import { createSegmentAction, previewSegmentAction } from "@/lib/actions/segment";
// Subpath import keeps the client bundle free of node:crypto (the shared
// barrel pulls in ids.ts). struggles.ts depends only on zod.
import { STRUGGLE_TYPES, type SegmentCondition } from "@tracki/shared/struggles";
import { Button, Input, Label } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SubmitButton } from "./submit-button";

interface Row {
  id: number;
  c: SegmentCondition;
}

const EVENT_TYPES = ["pageview", "click", "form_submit", "form_abandon", "track", "error"];

function defaultCondition(kind: SegmentCondition["kind"]): SegmentCondition {
  if (kind === "struggle") return { kind: "struggle", struggleType: "form_abandon" };
  if (kind === "event") return { kind: "event", eventType: "track" };
  return { kind: "identified", value: true };
}

export function SegmentBuilder({
  locale,
  orgSlug,
  projectSlug,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
}) {
  const t = useTranslations("segments");
  const tTypes = useTranslations("struggleTypes");
  const tEvents = useTranslations("eventTypes");
  const tRoot = useTranslations();
  const nextId = useRef(1);
  const [rows, setRows] = useState<Row[]>([
    { id: 0, c: { kind: "struggle", struggleType: "form_abandon" } },
  ]);
  const conditions = useMemo(() => rows.map((r) => r.c), [rows]);
  const [count, setCount] = useState<number | null>(null);
  const [, startPreview] = useTransition();
  const [state, action] = useActionState(createSegmentAction, undefined);

  // Live preview whenever conditions change (debounced).
  useEffect(() => {
    const handle = setTimeout(() => {
      startPreview(async () => {
        const res = await previewSegmentAction(locale, orgSlug, projectSlug, { conditions });
        setCount("count" in res ? res.count : null);
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [conditions, locale, orgSlug, projectSlug]);

  const update = (id: number, c: SegmentCondition) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, c } : r)));
  const remove = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));
  const add = (c: SegmentCondition) => setRows((prev) => [...prev, { id: nextId.current++, c }]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="definition" value={JSON.stringify({ conditions })} />

      <div className="space-y-1.5">
        <Label htmlFor="seg-name">{t("nameLabel")}</Label>
        <Input id="seg-name" name="name" placeholder={t("namePlaceholder")} required />
      </div>

      <div className="space-y-2">
        <Label>{t("conditionsLabel")}</Label>
        {rows.map(({ id, c }) => (
          <div
            key={id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
          >
            <select
              value={c.kind}
              onChange={(e) =>
                update(id, defaultCondition(e.target.value as SegmentCondition["kind"]))
              }
              className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="struggle">{t("kindStruggle")}</option>
              <option value="event">{t("kindEvent")}</option>
              <option value="identified">{t("kindIdentified")}</option>
            </select>

            {c.kind === "struggle" && (
              <select
                value={c.struggleType}
                onChange={(e) =>
                  update(id, {
                    kind: "struggle",
                    struggleType: e.target.value as (typeof STRUGGLE_TYPES)[number],
                  })
                }
                className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {STRUGGLE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {tTypes(s)}
                  </option>
                ))}
              </select>
            )}

            {c.kind === "event" && (
              <>
                <select
                  value={c.eventType}
                  onChange={(e) => update(id, { ...c, eventType: e.target.value })}
                  className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {EVENT_TYPES.map((ev) => (
                    <option key={ev} value={ev}>
                      {tEvents.has(ev) ? tEvents(ev) : ev}
                    </option>
                  ))}
                </select>
                <input
                  value={c.pathContains ?? ""}
                  onChange={(e) => update(id, { ...c, pathContains: e.target.value || undefined })}
                  placeholder={t("pathContains")}
                  dir="ltr"
                  className="h-9 w-40 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </>
            )}

            {c.kind === "identified" && (
              <select
                value={c.value ? "yes" : "no"}
                onChange={(e) =>
                  update(id, { kind: "identified", value: e.target.value === "yes" })
                }
                className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="yes">{t("identifiedYes")}</option>
                <option value="no">{t("identifiedNo")}</option>
              </select>
            )}

            {rows.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(id)}>
                {t("remove")}
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => add(defaultCondition("identified"))}
        >
          {t("addCondition")}
        </Button>
      </div>

      <div className="rounded-lg bg-blue-50 p-3 text-sm dark:bg-blue-900/20">
        {t("preview")}:{" "}
        <span className="font-bold text-blue-700 dark:text-blue-300">{count ?? "…"}</span>{" "}
        {t("matchingVisitors")}
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {tRoot(state.error)}
        </p>
      )}
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}
