"use client";

import { createActionAction, updateActionAction } from "@/lib/actions/action";
import {
  ACTION_SURFACES,
  ACTION_TRIGGERS,
  ACTION_TYPES,
  type ActionDefinition,
  type ActionSurface,
  type ActionTrigger,
  type ActionType,
  CTA_KINDS,
  type CtaKind,
  type TourStep,
  resolveCtaKind,
} from "@tracki/shared/actions";
import { STRUGGLE_TYPES, type StruggleType } from "@tracki/shared/struggles";
import { Button, Card, Input, Label } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";

interface Localized {
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}
const emptyLoc: Localized = { title: "", body: "", ctaLabel: "", ctaUrl: "" };

/** implementation: the CTA routes to a channel — URL, FAQ widget, Agent chat, or WhatsApp. */
function toContent(ar: Localized, en: Localized, kind: CtaKind) {
  const pack = (l: Localized) => {
    let cta: Record<string, unknown> | undefined;
    if (kind === "url") {
      if (l.ctaLabel && l.ctaUrl) cta = { label: l.ctaLabel, kind, url: l.ctaUrl };
    } else if (l.ctaLabel) {
      cta = { label: l.ctaLabel, kind };
    }
    return { title: l.title, body: l.body, ...(cta ? { cta } : {}) };
  };
  return { ar: pack(ar), en: pack(en) };
}

/** An existing action loaded into the builder (implementation — edit-in-place). */
export interface BuilderInitial {
  id: string;
  name: string;
  status: "draft" | "live";
  definition: ActionDefinition;
}

function fromContent(c?: {
  title: string;
  body: string;
  cta?: { label: string; url?: string };
}): Localized {
  return {
    title: c?.title ?? "",
    body: c?.body ?? "",
    ctaLabel: c?.cta?.label ?? "",
    ctaUrl: c?.cta?.url ?? "",
  };
}

const fieldCls =
  "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function ActionBuilder({
  locale,
  orgSlug,
  projectSlug,
  segments,
  initial,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
  segments: { id: string; name: string }[];
  initial?: BuilderInitial;
}) {
  const t = useTranslations("actions");
  const tRoot = useTranslations();
  const tStruggle = useTranslations("struggleTypes");
  const init = initial?.definition;
  const [type, setType] = useState<ActionType>(init?.type ?? "popup");
  // implementation: render surface; tour/drawer are mobile-only (no web renderer).
  const [surface, setSurface] = useState<ActionSurface>(init?.surface ?? "all");
  const [steps, setSteps] = useState<TourStep[]>(init?.steps ?? []);
  const mobileOnly = type === "tour" || type === "drawer";
  const effectiveSurface: ActionSurface = mobileOnly ? "mobile" : surface;
  const emptyStep: TourStep = { ar: { title: "", body: "" }, en: { title: "", body: "" } };
  const [trigger, setTrigger] = useState<ActionTrigger>(init?.trigger.kind ?? "rage_click");
  const [seconds, setSeconds] = useState(init?.trigger.seconds ?? 5);
  const [eventName, setEventName] = useState(init?.trigger.eventName ?? "");
  const [struggleTypes, setStruggleTypes] = useState<StruggleType[]>(init?.struggleTypes ?? []);
  const [segmentId, setSegmentId] = useState(init?.segmentId ?? "");
  const [urlContains, setUrlContains] = useState(init?.urlContains ?? "");
  const [frequencyCap, setFrequencyCap] = useState(init?.frequencyCap ?? 3);
  const [goalEvent, setGoalEvent] = useState(init?.goalEvent ?? "");
  const [anchorSelector, setAnchorSelector] = useState(init?.anchorSelector ?? "");
  const [ar, setAr] = useState<Localized>(init ? fromContent(init.content.ar) : emptyLoc);
  const [en, setEn] = useState<Localized>(init ? fromContent(init.content.en) : emptyLoc);
  const [hasB, setHasB] = useState(!!init?.contentB);
  const [arB, setArB] = useState<Localized>(
    init?.contentB ? fromContent(init.contentB.ar) : emptyLoc,
  );
  const [enB, setEnB] = useState<Localized>(
    init?.contentB ? fromContent(init.contentB.en) : emptyLoc,
  );
  const [status, setStatus] = useState<"draft" | "live">(initial?.status ?? "draft");
  const initCta = init?.content.ar.cta ?? init?.content.en.cta;
  const [ctaKind, setCtaKind] = useState<CtaKind>(initCta ? resolveCtaKind(initCta) : "url");
  const [previewLang, setPreviewLang] = useState<"ar" | "en">("ar");
  const [state, action] = useActionState(
    initial ? updateActionAction : createActionAction,
    undefined,
  );

  const definition = {
    type,
    ...(effectiveSurface !== "all" ? { surface: effectiveSurface } : {}),
    ...(type === "tour" && steps.length > 0 ? { steps } : {}),
    content: toContent(ar, en, ctaKind),
    ...(hasB ? { contentB: toContent(arB, enB, ctaKind) } : {}),
    trigger: {
      kind: trigger,
      ...(trigger === "time_on_page" ? { seconds } : {}),
      ...(trigger === "event" && eventName ? { eventName } : {}),
    },
    ...(urlContains ? { urlContains } : {}),
    ...(frequencyCap ? { frequencyCap } : {}),
    ...(goalEvent ? { goalEvent } : {}),
    ...(type === "tooltip" && anchorSelector ? { anchorSelector } : {}),
    ...(trigger === "struggle" && struggleTypes.length > 0 ? { struggleTypes } : {}),
    ...(trigger === "struggle" && segmentId ? { segmentId } : {}),
    // Audit 12 M1: the builder has no schedule field; carry a stored schedule
    // through edit so a full-definition replace can't silently erase it.
    ...(init?.schedule ? { schedule: init.schedule } : {}),
  };

  const preview = previewLang === "ar" ? ar : en;

  const locFields = (val: Localized, set: (l: Localized) => void, idPrefix: string) => (
    <div className="space-y-2">
      <Input
        placeholder={t("fieldTitle")}
        value={val.title}
        onChange={(e) => set({ ...val, title: e.target.value })}
        aria-label={`${idPrefix}-title`}
      />
      <Input
        placeholder={t("fieldBody")}
        value={val.body}
        onChange={(e) => set({ ...val, body: e.target.value })}
        aria-label={`${idPrefix}-body`}
      />
      <div className="flex gap-2">
        <Input
          placeholder={t("fieldCtaLabel")}
          value={val.ctaLabel}
          onChange={(e) => set({ ...val, ctaLabel: e.target.value })}
          aria-label={`${idPrefix}-cta-label`}
        />
        {ctaKind === "url" && (
          <Input
            placeholder={t("fieldCtaUrl")}
            value={val.ctaUrl}
            dir="ltr"
            onChange={(e) => set({ ...val, ctaUrl: e.target.value })}
            aria-label={`${idPrefix}-cta-url`}
          />
        )}
      </div>
    </div>
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="definition" value={JSON.stringify(definition)} />
      {initial && <input type="hidden" name="actionId" value={initial.id} />}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="act-name">{t("nameLabel")}</Label>
            <Input
              id="act-name"
              name="name"
              placeholder={t("namePlaceholder")}
              defaultValue={initial?.name}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("typeLabel")}</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ActionType)}
              className={fieldCls}
            >
              {ACTION_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`type${ty.charAt(0).toUpperCase()}${ty.slice(1)}` as "typePopup")}
                </option>
              ))}
            </select>
          </div>

          {/* implementation: where the action renders (web snippet / mobile SDKs). */}
          <div className="space-y-1.5">
            <Label>{t("surfaceLabel")}</Label>
            <select
              value={effectiveSurface}
              onChange={(e) => setSurface(e.target.value as ActionSurface)}
              disabled={mobileOnly}
              className={fieldCls}
            >
              {ACTION_SURFACES.map((s) => (
                <option key={s} value={s}>
                  {t(`surface${s.charAt(0).toUpperCase()}${s.slice(1)}` as "surfaceAll")}
                </option>
              ))}
            </select>
            {mobileOnly && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("mobileOnlyHint")}</p>
            )}
          </div>

          {/* implementation: guided-tour steps (bilingual, optional anchor key). */}
          {type === "tour" && (
            <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("tourSteps")}</p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSteps((prev) => [...prev, emptyStep])}
                  disabled={steps.length >= 10}
                >
                  {t("addStep")}
                </Button>
              </div>
              {steps.length === 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("tourNeedsStep")}</p>
              )}
              {steps.map((step, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
                <div key={i} className="space-y-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900/60">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{t("stepN", { n: i + 1 })}</span>
                    <button
                      type="button"
                      className="text-rose-600 hover:underline dark:text-rose-400"
                      onClick={() => setSteps((prev) => prev.filter((_, x) => x !== i))}
                    >
                      {t("removeStep")}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div dir="rtl" className="space-y-1.5">
                      <Input
                        placeholder={t("fieldTitle")}
                        value={step.ar.title}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((s, x) =>
                              x === i ? { ...s, ar: { ...s.ar, title: e.target.value } } : s,
                            ),
                          )
                        }
                      />
                      <Input
                        placeholder={t("fieldBody")}
                        value={step.ar.body}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((s, x) =>
                              x === i ? { ...s, ar: { ...s.ar, body: e.target.value } } : s,
                            ),
                          )
                        }
                      />
                    </div>
                    <div dir="ltr" className="space-y-1.5">
                      <Input
                        placeholder={t("fieldTitle")}
                        value={step.en.title}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((s, x) =>
                              x === i ? { ...s, en: { ...s.en, title: e.target.value } } : s,
                            ),
                          )
                        }
                      />
                      <Input
                        placeholder={t("fieldBody")}
                        value={step.en.body}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((s, x) =>
                              x === i ? { ...s, en: { ...s.en, body: e.target.value } } : s,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                  <Input
                    placeholder={t("stepAnchor")}
                    dir="ltr"
                    value={step.anchor ?? ""}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, x) =>
                          x === i ? { ...s, anchor: e.target.value || undefined } : s,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("contentAr")}</Label>
            <div dir="rtl">{locFields(ar, setAr, "ar")}</div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("contentEn")}</Label>
            <div dir="ltr">{locFields(en, setEn, "en")}</div>
          </div>

          {/* implementation — right channeling: where the CTA routes. */}
          <div className="space-y-1.5">
            <Label>{t("ctaKindLabel")}</Label>
            <select
              value={ctaKind}
              onChange={(e) => setCtaKind(e.target.value as CtaKind)}
              className={fieldCls}
            >
              {CTA_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`channel_${k}` as "channel_url")}
                </option>
              ))}
            </select>
            {ctaKind === "whatsapp" && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("whatsappCtaHint")}</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasB} onChange={(e) => setHasB(e.target.checked)} />
            {t("enableVariantB")}
          </label>
          {hasB && (
            <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-sm font-medium">{t("variantB")}</p>
              <div dir="rtl">{locFields(arB, setArB, "arb")}</div>
              <div dir="ltr">{locFields(enB, setEnB, "enb")}</div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("triggerLabel")}</Label>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as ActionTrigger)}
              className={fieldCls}
            >
              {ACTION_TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>
                  {t(
                    `trigger${tr === "pageview" ? "Pageview" : tr === "time_on_page" ? "Time" : tr === "exit_intent" ? "Exit" : tr === "rage_click" ? "Rage" : tr === "struggle" ? "Struggle" : "Event"}` as "triggerPageview",
                  )}
                </option>
              ))}
            </select>
          </div>
          {trigger === "struggle" && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-900/10">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{t("liveAssistHint")}</p>
              <div className="space-y-1.5">
                <Label>{t("struggleTypesLabel")}</Label>
                <div className="flex flex-wrap gap-3">
                  {STRUGGLE_TYPES.map((st) => (
                    <label key={st} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={struggleTypes.includes(st)}
                        onChange={(e) =>
                          setStruggleTypes((prev) =>
                            e.target.checked ? [...prev, st] : prev.filter((x) => x !== st),
                          )
                        }
                      />
                      {tStruggle(st)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("segmentLabel")}</Label>
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  className={fieldCls}
                >
                  <option value="">{t("segmentNone")}</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {trigger === "time_on_page" && (
            <div className="space-y-1.5">
              <Label>{t("seconds")}</Label>
              <Input
                type="number"
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
            </div>
          )}
          {trigger === "event" && (
            <div className="space-y-1.5">
              <Label>{t("eventName")}</Label>
              <Input value={eventName} dir="ltr" onChange={(e) => setEventName(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t("urlContains")}</Label>
            <Input
              value={urlContains}
              dir="ltr"
              placeholder="/checkout"
              onChange={(e) => setUrlContains(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("frequencyCap")}</Label>
            <Input
              type="number"
              value={frequencyCap}
              onChange={(e) => setFrequencyCap(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("goalEvent")}</Label>
            <Input
              value={goalEvent}
              dir="ltr"
              placeholder="purchase"
              onChange={(e) => setGoalEvent(e.target.value)}
            />
          </div>
          {type === "tooltip" && (
            <div className="space-y-1.5">
              <Label>{t("anchorSelector")}</Label>
              <Input
                value={anchorSelector}
                dir="ltr"
                onChange={(e) => setAnchorSelector(e.target.value)}
              />
            </div>
          )}

          {/* Live RTL/LTR preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("preview")}</Label>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewLang("ar")}
                  className={`rounded px-2 py-0.5 ${previewLang === "ar" ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
                >
                  ع
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewLang("en")}
                  className={`rounded px-2 py-0.5 ${previewLang === "en" ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
                >
                  EN
                </button>
              </div>
            </div>
            <Card className="flex min-h-32 items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
              <div
                dir={previewLang === "ar" ? "rtl" : "ltr"}
                className="w-full max-w-xs rounded-xl bg-white p-4 text-zinc-900 shadow-lg"
              >
                <div className="font-bold">{preview.title || t("fieldTitle")}</div>
                <div className="mt-1 text-sm opacity-80">{preview.body || t("fieldBody")}</div>
                {preview.ctaLabel && (
                  <span className="mt-3 inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white">
                    {preview.ctaLabel}
                  </span>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-1.5">
            <Label>{t("statusLabel")}</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "draft" | "live")}
              className={fieldCls}
            >
              <option value="draft">{t("draft")}</option>
              <option value="live">{t("live")}</option>
            </select>
          </div>
        </div>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {tRoot(state.error)}
        </p>
      )}
      <SubmitButton>{initial ? t("update") : t("save")}</SubmitButton>
    </form>
  );
}
