import { CopyButton } from "@/components/copy-button";
import { InviteForm } from "@/components/org-forms";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { invitations, memberships, users } from "@/db/schema";
import { requireMembership } from "@/lib/tenancy";
import { MANAGER_ROLES } from "@tracki/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org, role } = await requireMembership(locale, orgSlug);
  const t = await getTranslations("settings");

  const members = await db
    .select({ name: users.name, email: users.email, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.orgId, org.id));

  const canManage = MANAGER_ROLES.includes(role);

  const pending = canManage
    ? await db
        .select({ email: invitations.email, role: invitations.role, token: invitations.token })
        .from(invitations)
        .where(
          and(
            eq(invitations.orgId, org.id),
            isNull(invitations.acceptedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
    : [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("membersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {members.map((member) => (
              <li key={member.email} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400" dir="ltr">
                    {member.email}
                  </p>
                </div>
                <Badge tone={member.role === "owner" ? "success" : "neutral"}>
                  {t(`roles.${member.role}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("inviteTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InviteForm locale={locale} orgSlug={orgSlug} />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("noSmtpNote")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("pendingTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pendingEmpty")}</p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {pending.map((invite) => (
                    <li key={invite.token} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" dir="ltr">
                          {invite.email}
                        </p>
                        <Badge>{t(`roles.${invite.role}`)}</Badge>
                      </div>
                      <CopyButton
                        text={`${appUrl}/${locale}/invite/${invite.token}`}
                        label={t("copyLink")}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
