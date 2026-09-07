import {
  ActivityIcon,
  ArrowEndIcon,
  GlobeIcon,
  LayersIcon,
  LockIcon,
  SparklesIcon,
} from "@/components/landing-icons";
import {
  CrossLinks,
  CtaBand,
  FeatureCard,
  PageSection,
  ProductHero,
  SectionHeading,
} from "@/components/marketing/sections";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.platform");
  return { title: `${t("name")} — Tracki` };
}

/** The moat page: the real-time behavioral data layer every product consumes. */
export default async function PlatformPage() {
  const t = await getTranslations("mkt.platform");
  const c = await getTranslations("mkt.common");

  const pillars = [
    { title: t("c1T"), desc: t("c1D") },
    { title: t("c2T"), desc: t("c2D") },
    { title: t("c3T"), desc: t("c3D") },
  ];

  const features = [
    { Icon: ActivityIcon, title: t("f1T"), desc: t("f1D") },
    { Icon: SparklesIcon, title: t("f2T"), desc: t("f2D") },
    { Icon: LockIcon, title: t("f3T"), desc: t("f3D") },
    { Icon: GlobeIcon, title: t("f4T"), desc: t("f4D") },
  ];

  return (
    <>
      <ProductHero
        badge={t("badge")}
        title={t("title")}
        subtitle={t("subtitle")}
        bullets={[t("b1"), t("b2"), t("b3")]}
        ctaPrimary={c("ctaPrimary")}
        ctaSecondary={c("demo")}
        Icon={LayersIcon}
      />

      {/* Collect → Understand → Act */}
      <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading title={t("pillarsTitle")} subtitle={t("pillarsSubtitle")} />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {pillars.map((p, i) => (
              <div
                key={p.title}
                className="relative rounded-2xl border border-zinc-200 bg-white p-7 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-base font-bold text-white dark:bg-blue-500">
                    {i + 1}
                  </span>
                  <h3 className="text-xl font-semibold">{p.title}</h3>
                  {i < 2 ? (
                    <ArrowEndIcon className="ms-auto hidden h-5 w-5 text-zinc-300 md:block dark:text-zinc-600" />
                  ) : null}
                </div>
                <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PageSection>
        <SectionHeading title={t("featuresTitle")} />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {features.map((f) => (
            <FeatureCard key={f.title} Icon={f.Icon} title={f.title} desc={f.desc} />
          ))}
        </div>
      </PageSection>

      <CrossLinks siblings={["web", "agent", "connect"]} />
      <CtaBand />
    </>
  );
}
