import { PageHeader, StatCard } from "@/components/page-header";
import { db } from "@/db";
import { demoRequests } from "@/db/schema";
import { requireStaff } from "@/lib/tenancy";
import { Badge, Card, CardContent } from "@tracki/ui";
import { desc } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";

export default async function AdminLeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale); // 404s non-staff; route is hidden
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const leads = await db
    .select({
      id: demoRequests.id,
      name: demoRequests.name,
      email: demoRequests.email,
      company: demoRequests.company,
      message: demoRequests.message,
      locale: demoRequests.locale,
      createdAt: demoRequests.createdAt,
    })
    .from(demoRequests)
    .orderBy(desc(demoRequests.createdAt))
    .limit(200);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <PageHeader title={t("leadsTitle")} subtitle={t("leadsSubtitle")} />

      <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
        <StatCard label={t("total")} value={String(leads.length)} accent />
      </div>

      {leads.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {leads.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{l.name}</span>
                      {l.company ? <Badge>{l.company}</Badge> : null}
                      <Badge tone="neutral">{l.locale.toUpperCase()}</Badge>
                    </div>
                    <a
                      href={`mailto:${l.email}`}
                      dir="ltr"
                      className="mt-0.5 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {l.email}
                    </a>
                    {l.message ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {l.message}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {format.dateTime(l.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
