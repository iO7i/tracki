import { CreateOrgForm } from "@/components/org-forms";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { memberships, organizations } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/tenancy";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

export default async function OrgsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireUser(locale);
  const t = await getTranslations("orgs");
  const tSettings = await getTranslations("settings");

  const orgs = await db
    .select({
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, user.id));

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {orgs.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {orgs.map((org) => (
            <Link key={org.slug} href={`/orgs/${org.slug}`} className="group">
              <Card className="transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:hover:border-blue-700">
                <CardContent className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-bold text-white"
                    aria-hidden="true"
                  >
                    {org.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-zinc-900 dark:text-zinc-100">
                    {org.name}
                  </span>
                  <Badge tone={org.role === "owner" ? "success" : "neutral"}>
                    {tSettings(`roles.${org.role}`)}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("createTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOrgForm locale={locale} />
        </CardContent>
      </Card>
    </main>
  );
}
