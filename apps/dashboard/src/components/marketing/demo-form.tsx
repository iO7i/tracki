"use client";

import { CheckIcon } from "@/components/landing-icons";
import { SubmitButton } from "@/components/submit-button";
import { type DemoState, submitDemoAction } from "@/lib/actions/demo";
import { Input, Label } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

const fieldCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100";

export function DemoForm({ locale }: { locale: string }) {
  const [state, action] = useActionState<DemoState, FormData>(submitDemoAction, undefined);
  const t = useTranslations("mkt.demo");
  const tErr = useTranslations();

  if (state && "ok" in state) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8 text-center dark:border-blue-900/40 dark:bg-blue-900/10">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-500">
          <CheckIcon className="h-6 w-6" />
        </span>
        <h2 className="mt-5 text-xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("successTitle")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {t("successBody")}
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="demo-name">{t("name")}</Label>
          <Input id="demo-name" name="name" required placeholder={t("namePh")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="demo-email">{t("email")}</Label>
          <Input
            id="demo-email"
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder={t("emailPh")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="demo-company">{t("company")}</Label>
          <Input id="demo-company" name="company" placeholder={t("companyPh")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="demo-message">{t("message")}</Label>
          <textarea
            id="demo-message"
            name="message"
            rows={4}
            placeholder={t("messagePh")}
            className={fieldCls}
          />
        </div>
      </div>

      {state && "error" in state ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {tErr(state.error)}
        </p>
      ) : null}

      <SubmitButton className="mt-6 w-full">{t("submit")}</SubmitButton>
      <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">{t("privacy")}</p>
    </form>
  );
}
