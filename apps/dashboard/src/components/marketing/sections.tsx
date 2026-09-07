import { ArrowEndIcon, CheckIcon } from "@/components/landing-icons";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import type { ComponentType, ReactNode } from "react";

/**
 * Shared building blocks for the marketing pages. All server components,
 * logical-properties only (RTL-safe), strings always via next-intl.
 */

export const primaryCta =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-600";
export const secondaryCta =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

/** Map a product/page namespace to its route. */
export const PRODUCT_HREFS = {
  web: "/product/web",
  mobile: "/product/mobile",
  agent: "/product/agent",
  connect: "/product/connect",
  voc: "/product/voc",
  knowledge: "/product/knowledge",
  platform: "/platform",
} as const;

export type ProductNs = keyof typeof PRODUCT_HREFS;

export type IconComponent = ComponentType<{ className?: string }>;

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {subtitle ? (
        <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function FeatureCard({
  Icon,
  title,
  desc,
}: {
  Icon: IconComponent;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{desc}</p>
    </div>
  );
}

export function StepItem({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="relative">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-lg font-bold text-white dark:bg-blue-500">
        {n}
      </span>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{desc}</p>
    </div>
  );
}

/** Hero for product pages: copy on one side, a bullet "capability card" on the other. */
export function ProductHero({
  badge,
  title,
  subtitle,
  bullets,
  ctaPrimary,
  ctaSecondary,
  Icon,
}: {
  badge: string;
  title: string;
  subtitle: string;
  bullets: string[];
  ctaPrimary: string;
  ctaSecondary: string;
  Icon: IconComponent;
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_0%,rgba(37,99,235,0.12),transparent_70%)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
            <Icon className="h-3.5 w-3.5" />
            {badge}
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            {subtitle}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={primaryCta}>
              {ctaPrimary}
            </Link>
            <Link href="/demo" className={secondaryCta}>
              {ctaSecondary}
            </Link>
          </div>
        </div>
        <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white dark:bg-blue-500">
            <Icon className="h-6 w-6" />
          </span>
          <ul className="mt-5 space-y-4">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function MetricsBand({
  title,
  caption,
  metrics,
}: {
  title: string;
  caption: string;
  metrics: { value: string; label: string }[];
}) {
  return (
    <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
          {metrics.map((m) => (
            <div key={m.label} className="text-center">
              <div className="text-4xl font-extrabold tracking-tight text-blue-600 sm:text-5xl dark:text-blue-400">
                {m.value}
              </div>
              <p className="mx-auto mt-2 max-w-[18rem] text-sm text-zinc-600 dark:text-zinc-400">
                {m.label}
              </p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
          {caption}
        </p>
      </div>
    </section>
  );
}

/** "Better together" cross-links to sibling products. */
export async function CrossLinks({ siblings }: { siblings: ProductNs[] }) {
  const t = await getTranslations("mkt");
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
      <SectionHeading title={t("common.worksWith")} subtitle={t("common.worksWithSub")} />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {siblings.map((ns) => (
          <Link
            key={ns}
            href={PRODUCT_HREFS[ns]}
            className="group rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-400">
              {t(`${ns}.name`)}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {t(`${ns}.tag`)}
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 transition-colors group-hover:text-blue-600 dark:text-zinc-400 dark:group-hover:text-blue-400">
              {t("common.learnMore")}
              <ArrowEndIcon className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Closing call-to-action band shared by all marketing pages. */
export async function CtaBand({ title, subtitle }: { title?: string; subtitle?: string } = {}) {
  const t = await getTranslations("mkt.common");
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-4 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 to-blue-800 px-6 py-16 text-center text-white sm:px-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(255,255,255,0.18),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {title ?? t("ctaTitle")}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-blue-50">
            {subtitle ?? t("ctaSubtitle")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
            >
              {t("ctaPrimary")}
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {t("ctaSecondary")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PageSection({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-20">
      {children}
    </section>
  );
}
