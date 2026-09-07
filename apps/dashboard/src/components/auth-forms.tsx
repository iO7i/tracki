"use client";

import { loginAction, signupAction } from "@/lib/actions/auth";
import { Input, Label } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "./submit-button";

function FormError({ error }: { error?: string }) {
  const t = useTranslations();
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {t(error)}
    </p>
  );
}

export function LoginForm({ locale, next }: { locale: string; next?: string }) {
  const [state, action] = useActionState(loginAction, undefined);
  const t = useTranslations("auth");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
        />
      </div>
      <FormError error={state?.error} />
      <SubmitButton className="w-full">{t("loginCta")}</SubmitButton>
    </form>
  );
}

export function SignupForm({ locale, next }: { locale: string; next?: string }) {
  const [state, action] = useActionState(signupAction, undefined);
  const t = useTranslations("auth");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          dir="ltr"
        />
      </div>
      <FormError error={state?.error} />
      <SubmitButton className="w-full">{t("signupCta")}</SubmitButton>
    </form>
  );
}
