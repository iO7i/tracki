import { CheckIcon } from "@/components/landing-icons";
import { CtaBand, SectionHeading, primaryCta, secondaryCta } from "@/components/marketing/sections";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.nav");
  return { title: `${t("pricing")} — Tracki` };
}

const FEATURE_COUNTS = { t1: 4, t2: 5, t3: 4 } as const;

export default async function PricingPage() {
  const t = await getTranslations("mkt.pricing");

  const tiers = (["t1", "t2", "t3"] as const).map((k) => ({
    key: k,
    name: t(`${k}Name`),
    price: t(`${k}Price`),
    desc: t(`${k}Desc`),
    cta: t(`${k}Cta`),
    features: Array.from({ length: FEATURE_COUNTS[k] }, (_, i) => t(`${k}f${i + 1}`)),
    popular: k === "t2",
    custom: k === "t3",
  }));

  const faqs = [1, 2, 3, 4].map((n) => ({ q: t(`q${n}`), a: t(`a${n}`) }));

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_0%,rgba(37,99,235,0.12),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-8 pt-16 text-center sm:px-6 lg:pt-24">
          <h1 className="mx-auto max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.key}
              className={`relative flex flex-col rounded-3xl border bg-white p-8 dark:bg-zinc-900 ${
                tier.popular
                  ? "border-blue-400 shadow-lg ring-1 ring-blue-400 dark:border-blue-600 dark:ring-blue-600"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              {tier.popular ? (
                <span className="absolute -top-3.5 start-8 inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white dark:bg-blue-500">
                  {t("popular")}
                </span>
              ) : null}
              <h2 className="text-lg font-semibold">{tier.name}</h2>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold tracking-tight">{tier.price}</span>
                {!tier.custom ? (
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("perMonth")}</span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {tier.desc}
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.custom ? "/login" : "/signup"}
                className={`${tier.popular ? primaryCta : secondaryCta} mt-8 w-full`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
          {t("note")}
        </p>
      </section>

      {/* Pricing FAQ */}
      <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading title={t("faqTitle")} />
          <div className="mt-10 space-y-4">
            {faqs.map((f) => (
              <div
                key={f.q}
                className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h3 className="text-base font-semibold">{f.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="pt-16">
        <CtaBand />
      </div>
    </>
  );
}
