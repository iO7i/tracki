"use client";

import { createFaqAction, importFaqCsvAction } from "@/lib/actions/faq";
import { Button, Input, Label } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "./submit-button";

const fieldCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function FormError({ error }: { error?: string }) {
  const t = useTranslations();
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {t(error)}
    </p>
  );
}

export function FaqEditor({
  locale,
  orgSlug,
  projectSlug,
  initialTitleAr,
  initialTitleEn,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
  // Prefilled from a VoC knowledge-gap "Draft FAQ" hand-off (implementation).
  initialTitleAr?: string;
  initialTitleEn?: string;
}) {
  const [state, action] = useActionState(createFaqAction, undefined);
  const t = useTranslations("faq");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="faq-cat">{t("categoryLabel")}</Label>
          <Input id="faq-cat" name="category" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="faq-tags">{t("tagsLabel")}</Label>
          <Input id="faq-tags" name="tags" dir="ltr" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2" dir="rtl">
          <Label>{t("titleArLabel")}</Label>
          <Input name="titleAr" defaultValue={initialTitleAr} />
          <Label>{t("bodyArLabel")}</Label>
          <textarea name="bodyAr" rows={5} className={fieldCls} />
        </div>
        <div className="space-y-2" dir="ltr">
          <Label>{t("titleEnLabel")}</Label>
          <Input name="titleEn" defaultValue={initialTitleEn} />
          <Label>{t("bodyEnLabel")}</Label>
          <textarea name="bodyEn" rows={5} className={fieldCls} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="faq-status">{t("statusLabel")}</Label>
        <select id="faq-status" name="status" defaultValue="published" className={fieldCls}>
          <option value="draft">{t("draft")}</option>
          <option value="published">{t("published")}</option>
        </select>
      </div>

      <FormError error={state?.error} />
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function FaqCsvImport({
  locale,
  orgSlug,
  projectSlug,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
}) {
  const [state, action] = useActionState(importFaqCsvAction, undefined);
  const t = useTranslations("faq");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("importHelp")}</p>
      <textarea
        name="csv"
        rows={5}
        dir="ltr"
        className={`${fieldCls} font-mono text-xs`}
        placeholder="billing,الدفع,كيفية الدفع,Payment,How to pay,pay;billing"
      />
      <FormError error={state?.error} />
      <SubmitButton variant="secondary">{t("importCta")}</SubmitButton>
    </form>
  );
}
