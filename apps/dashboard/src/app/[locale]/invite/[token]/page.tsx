import { AcceptInviteForm } from "@/components/org-forms";
import { db } from "@/db";
import { invitations, organizations } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

/**
 * Audit M2: the org name and role are tenant-confidential. They render ONLY
 * after the signed-in user's email matches the invitation. Unauthenticated
 * holders of the link get a generic sign-in prompt.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations("invite");
  const tSettings = await getTranslations("settings");
  const tErrors = await getTranslations("errors");

  const rows = await db
    .select({
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      orgName: organizations.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(invitations.orgId, organizations.id))
    .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
    .limit(1);

  const invite = rows[0];
  const valid = invite && invite.expiresAt.getTime() > Date.now();
  const user = await getCurrentUser();
  const next = `/${locale}/invite/${token}`;

  let body: ReactNode;
  if (!valid) {
    body = <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("expiredOrInvalid")}</p>;
  } else if (!user) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("signInPrompt")}</p>
        <div className="flex gap-3">
          <Link href={{ pathname: "/login", query: { next } }} className="flex-1">
            <Button variant="secondary" className="w-full">
              {t("signInCta")}
            </Button>
          </Link>
          <Link href={{ pathname: "/signup", query: { next } }} className="flex-1">
            <Button className="w-full">{t("signupCta")}</Button>
          </Link>
        </div>
      </div>
    );
  } else if (user.email !== invite.email) {
    body = (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{tErrors("inviteWrongEmail")}</p>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-sm">
          {t("invitedToJoin", {
            org: invite.orgName,
            role: tSettings(`roles.${invite.role}`),
          })}
        </p>
        <AcceptInviteForm locale={locale} token={token} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{body}</CardContent>
      </Card>
    </div>
  );
}
