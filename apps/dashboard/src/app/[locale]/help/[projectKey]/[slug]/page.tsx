import { HelpTracker } from "@/components/help-tracker";
import { Link } from "@/i18n/navigation";
import { dirFor } from "@/i18n/routing";
import { projectByPublicKey, publishedArticleBySlug } from "@/lib/faq";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ locale: string; projectKey: string; slug: string }>;
}) {
  const { locale, projectKey, slug } = await params;
  const t = await getTranslations("help");

  const project = await projectByPublicKey(projectKey);
  if (!project) notFound();
  const article = await publishedArticleBySlug(project.id, slug);
  if (!article) notFound();

  const isAr = locale === "ar";
  const title = isAr ? article.titleAr || article.titleEn : article.titleEn || article.titleAr;
  const body = isAr ? article.bodyAr || article.bodyEn : article.bodyEn || article.bodyAr;

  return (
    <div dir={dirFor(locale)} className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <HelpTracker projectKey={projectKey} type="faq_view" articleId={article.id} />
      <header className="bg-white px-6 py-5 shadow-sm dark:bg-zinc-900">
        <div className="mx-auto max-w-3xl">
          <Link
            href={`/help/${projectKey}`}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            ← {t("back")}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <article className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="mb-4 text-2xl font-bold">{title}</h1>
          {/* Plain text rendered safely (React escapes); whitespace preserved. */}
          <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-700 dark:text-zinc-300">
            {body}
          </div>
        </article>
      </main>
    </div>
  );
}
