import { HelpTracker } from "@/components/help-tracker";
import { Link } from "@/i18n/navigation";
import { dirFor } from "@/i18n/routing";
import { projectByPublicKey, searchPublishedArticles } from "@/lib/faq";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

export default async function HelpCenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectKey: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, projectKey } = await params;
  const { q = "" } = await searchParams;
  const t = await getTranslations("help");

  const project = await projectByPublicKey(projectKey);
  if (!project) notFound();

  const articles = await searchPublishedArticles(project.id, q);
  const isAr = locale === "ar";
  const title = (a: { titleAr: string; titleEn: string }) =>
    isAr ? a.titleAr || a.titleEn : a.titleEn || a.titleAr;

  // Group by category when not searching.
  const byCategory = new Map<string, typeof articles>();
  for (const a of articles) {
    const cat = a.category || t("allArticles");
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), a]);
  }

  return (
    <div dir={dirFor(locale)} className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="bg-white px-6 py-5 shadow-sm dark:bg-zinc-900">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-xl font-bold text-blue-600 dark:text-blue-400">{project.name}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <form className="mb-6">
          <input
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </form>

        {/* Track the search (and whether it had results). */}
        {q ? (
          <HelpTracker
            projectKey={projectKey}
            type={articles.length === 0 ? "faq_search_noresult" : "faq_search"}
            query={q}
          />
        ) : null}

        {articles.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noResults")}</p>
        ) : (
          <div className="space-y-8">
            {[...byCategory.entries()].map(([cat, list]) => (
              <section key={cat}>
                <h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                  {cat}
                </h2>
                <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${projectKey}/${a.slug}`}
                        className="block px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        {title(a)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
