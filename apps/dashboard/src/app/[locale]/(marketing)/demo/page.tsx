import { CheckIcon } from "@/components/landing-icons";
import { DemoForm } from "@/components/marketing/demo-form";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.demo");
  return { title: `${t("title")} — Tracki` };
}

export default async function DemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("mkt.demo");
  const expects = [t("e1"), t("e2"), t("e3")];

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(37,99,235,0.10),transparent_70%)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-start gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("expectTitle")}
          </h2>
          <ul className="mt-4 space-y-3">
            {expects.map((e) => (
              <li key={e} className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {e}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:pt-2">
          <DemoForm locale={locale} />
        </div>
      </div>
    </section>
  );
}
