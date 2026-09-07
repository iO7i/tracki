import {
  ActivityIcon,
  EyeOffIcon,
  LockIcon,
  ServerIcon,
  ShieldIcon,
  SparklesIcon,
} from "@/components/landing-icons";
import { CtaBand, FeatureCard } from "@/components/marketing/sections";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.nav");
  return { title: `${t("security")} — Tracki` };
}

export default async function SecurityPage() {
  const t = await getTranslations("mkt.security");

  const sections = [
    { Icon: ServerIcon, title: t("s1T"), desc: t("s1D") },
    { Icon: EyeOffIcon, title: t("s2T"), desc: t("s2D") },
    { Icon: LockIcon, title: t("s3T"), desc: t("s3D") },
    { Icon: SparklesIcon, title: t("s4T"), desc: t("s4D") },
    { Icon: ActivityIcon, title: t("s5T"), desc: t("s5D") },
    { Icon: ShieldIcon, title: t("s6T"), desc: t("s6D") },
  ];

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_0%,rgba(37,99,235,0.12),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-8 pt-16 text-center sm:px-6 lg:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
            <ShieldIcon className="h-3.5 w-3.5" />
            {t("badge")}
          </span>
          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("subtitle")}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <FeatureCard key={s.title} Icon={s.Icon} title={s.title} desc={s.desc} />
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
          {t("roadmapNote")}
        </p>
      </section>

      <div className="pt-8">
        <CtaBand title={t("ctaTitle")} subtitle={t("ctaSubtitle")} />
      </div>
    </>
  );
}
