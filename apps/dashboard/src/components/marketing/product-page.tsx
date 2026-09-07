import {
  CrossLinks,
  CtaBand,
  FeatureCard,
  type IconComponent,
  MetricsBand,
  PageSection,
  ProductHero,
  type ProductNs,
  SectionHeading,
  StepItem,
} from "@/components/marketing/sections";
import { getTranslations } from "next-intl/server";

/**
 * Template every product marketing page is assembled from:
 * hero → 4-feature grid → 3-step "how it works" → (optional) metrics → cross-links → CTA.
 * Content is fully i18n-driven from the `mkt.<ns>` namespace.
 */
export async function ProductPage({
  ns,
  Icon,
  featureIcons,
  siblings,
  metrics = false,
}: {
  ns: ProductNs;
  Icon: IconComponent;
  featureIcons: [IconComponent, IconComponent, IconComponent, IconComponent];
  siblings: ProductNs[];
  metrics?: boolean;
}) {
  const t = await getTranslations(`mkt.${ns}`);
  const c = await getTranslations("mkt.common");

  const features = featureIcons.map((FIcon, i) => ({
    Icon: FIcon,
    title: t(`f${i + 1}T`),
    desc: t(`f${i + 1}D`),
  }));
  const steps = [1, 2, 3].map((n) => ({ n: String(n), title: t(`s${n}T`), desc: t(`s${n}D`) }));

  return (
    <>
      <ProductHero
        badge={t("name")}
        title={t("title")}
        subtitle={t("subtitle")}
        bullets={[t("b1"), t("b2"), t("b3")]}
        ctaPrimary={c("ctaPrimary")}
        ctaSecondary={c("demo")}
        Icon={Icon}
      />

      <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading title={t("featuresTitle")} />
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {features.map((f) => (
              <FeatureCard key={f.title} Icon={f.Icon} title={f.title} desc={f.desc} />
            ))}
          </div>
        </div>
      </section>

      <PageSection>
        <SectionHeading title={t("stepsTitle")} />
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {steps.map((s) => (
            <StepItem key={s.n} n={s.n} title={s.title} desc={s.desc} />
          ))}
        </div>
      </PageSection>

      {metrics ? (
        <MetricsBand
          title={c("metricsTitle")}
          caption={t("mCaption")}
          metrics={[
            { value: t("m1V"), label: t("m1L") },
            { value: t("m2V"), label: t("m2L") },
          ]}
        />
      ) : null}

      <CrossLinks siblings={siblings} />
      <CtaBand />
    </>
  );
}
