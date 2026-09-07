"use client";

import { acceptInviteAction, createOrgAction, inviteAction } from "@/lib/actions/org";
import { createProjectAction } from "@/lib/actions/project";
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

export function CreateOrgForm({ locale }: { locale: string }) {
  const [state, action] = useActionState(createOrgAction, undefined);
  const t = useTranslations("orgs");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-1.5">
        <Label htmlFor="org-name">{t("nameLabel")}</Label>
        <Input id="org-name" name="name" placeholder={t("namePlaceholder")} required />
      </div>
      <FormError error={state?.error} />
      <SubmitButton>{t("createCta")}</SubmitButton>
    </form>
  );
}

export function CreateProjectForm({ locale, orgSlug }: { locale: string; orgSlug: string }) {
  const [state, action] = useActionState(createProjectAction, undefined);
  const t = useTranslations("org");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div className="space-y-1.5">
        <Label htmlFor="project-name">{t("projectNameLabel")}</Label>
        <Input id="project-name" name="name" placeholder={t("projectNamePlaceholder")} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="site-url">{t("siteUrlLabel")}</Label>
        <Input
          id="site-url"
          name="siteUrl"
          type="url"
          placeholder={t("siteUrlPlaceholder")}
          dir="ltr"
        />
      </div>
      <FormError error={state?.error} />
      <SubmitButton>{t("createProjectCta")}</SubmitButton>
    </form>
  );
}

export function InviteForm({ locale, orgSlug }: { locale: string; orgSlug: string }) {
  const [state, action] = useActionState(inviteAction, undefined);
  const t = useTranslations("settings");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">{t("inviteEmailLabel")}</Label>
        <Input id="invite-email" name="email" type="email" required dir="ltr" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-role">{t("roleLabel")}</Label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="member">{t("roles.member")}</option>
          <option value="admin">{t("roles.admin")}</option>
        </select>
      </div>
      <FormError error={state?.error} />
      <SubmitButton>{t("inviteCta")}</SubmitButton>
    </form>
  );
}

export function AcceptInviteForm({ locale, token }: { locale: string; token: string }) {
  const [state, action] = useActionState(acceptInviteAction, undefined);
  const t = useTranslations("invite");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <FormError error={state?.error} />
      <SubmitButton className="w-full">{t("accept")}</SubmitButton>
    </form>
  );
}
