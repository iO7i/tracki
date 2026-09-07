import {
  ActivityIcon,
  AlertIcon,
  ArrowEndIcon,
  BookIcon,
  BuildingIcon,
  CartIcon,
  ChatIcon,
  CheckIcon,
  ClipboardIcon,
  CursorIcon,
  EyeOffIcon,
  GlobeIcon,
  LandmarkIcon,
  LayersIcon,
  LockIcon,
  PlaneIcon,
  ServerIcon,
  ShieldIcon,
  SignalIcon,
  SparklesIcon,
  WhatsappIcon,
} from "@/components/landing-icons";
import {
  CtaBand,
  PRODUCT_HREFS,
  type ProductNs,
  SectionHeading,
  StepItem,
  primaryCta,
  secondaryCta,
} from "@/components/marketing/sections";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

const SUITE: { ns: ProductNs; Icon: typeof ActivityIcon }[] = [
  { ns: "web", Icon: CursorIcon },
  { ns: "agent", Icon: ChatIcon },
  { ns: "connect", Icon: WhatsappIcon },
  { ns: "voc", Icon: ClipboardIcon },
  { ns: "knowledge", Icon: BookIcon },
  { ns: "platform", Icon: LayersIcon },
];

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const m = await getTranslations("mkt");

  const stats = [
    { value: t("stat1Value"), label: t("stat1Label") },
    { value: t("stat2Value"), label: t("stat2Label") },
    { value: t("stat3Value"), label: t("stat3Label") },
    { value: t("stat4Value"), label: t("stat4Label") },
  ];

  const features = [
    { Icon: ActivityIcon, title: t("f1Title"), desc: t("f1Desc") },
    { Icon: AlertIcon, title: t("f2Title"), desc: t("f2Desc") },
    { Icon: CursorIcon, title: t("f3Title"), desc: t("f3Desc") },
    { Icon: BookIcon, title: t("f4Title"), desc: t("f4Desc") },
    { Icon: SparklesIcon, title: t("f5Title"), desc: t("f5Desc") },
    { Icon: ChatIcon, title: t("f6Title"), desc: t("f6Desc") },
  ];

  const steps = [
    { n: "1", title: t("how1Title"), desc: t("how1Desc") },
    { n: "2", title: t("how2Title"), desc: t("how2Desc") },
    { n: "3", title: t("how3Title"), desc: t("how3Desc") },
    { n: "4", title: t("how4Title"), desc: t("how4Desc") },
    { n: "5", title: t("how5Title"), desc: t("how5Desc") },
  ];

  const diffs = [
    { Icon: GlobeIcon, title: t("diff1Title"), desc: t("diff1Desc") },
    { Icon: WhatsappIcon, title: t("diff2Title"), desc: t("diff2Desc") },
    { Icon: ShieldIcon, title: t("diff3Title"), desc: t("diff3Desc") },
  ];

  const industries = [
    { Icon: LandmarkIcon, title: t("ind1T"), desc: t("ind1D") },
    { Icon: SignalIcon, title: t("ind2T"), desc: t("ind2D") },
    { Icon: CartIcon, title: t("ind3T"), desc: t("ind3D") },
    { Icon: BuildingIcon, title: t("ind4T"), desc: t("ind4D") },
    { Icon: PlaneIcon, title: t("ind5T"), desc: t("ind5D") },
  ];

  const trust = [
    { Icon: ServerIcon, title: t("trust1T"), desc: t("trust1D") },
    { Icon: EyeOffIcon, title: t("trust2T"), desc: t("trust2D") },
    { Icon: ShieldIcon, title: t("trust3T"), desc: t("trust3D") },
    { Icon: LockIcon, title: t("trust4T"), desc: t("trust4D") },
  ];

  const proofs = [
    { org: t("proof1Org"), desc: t("proof1Desc") },
    { org: t("proof2Org"), desc: t("proof2Desc") },
    { org: t("proof3Org"), desc: t("proof3Desc") },
  ];

  return (
    <>
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_0%,rgba(37,99,235,0.12),transparent_70%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              {t("heroBadge")}
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {t("heroTitle")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
              {t("heroSubtitle")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={primaryCta}>
                {t("heroCtaPrimary")}
              </Link>
              <Link href="/demo" className={secondaryCta}>
                {t("heroCtaSecondary")}
              </Link>
            </div>
            <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-500">{t("heroNote")}</p>
          </div>

          {/* Product mock — detect → assist → WhatsApp handoff */}
          <div className="relative">
            <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-1.5 pb-4">
                <span className="h-3 w-3 rounded-full bg-red-400/80" />
                <span className="h-3 w-3 rounded-full bg-amber-400/80" />
                <span className="h-3 w-3 rounded-full bg-blue-400/80" />
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {t("mockStruggle")}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/70">
                    {t("mockStruggleDesc")}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                  <SparklesIcon className="h-4 w-4" />
                </span>
                <div className="rounded-2xl rounded-ss-sm bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    {t("mockAssist")}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                    {t("mockAssistMsg")}
                  </p>
                </div>
              </div>

              <button
                type="button"
                tabIndex={-1}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <WhatsappIcon className="h-4 w-4" />
                {t("mockHandoff")}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats band ──────────────────────────────────────── */}
      <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("statsTitle")}
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-8 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-4xl font-extrabold tracking-tight text-blue-600 sm:text-5xl dark:text-blue-400">
                  {s.value}
                </div>
                <p className="mx-auto mt-2 max-w-[14rem] text-sm text-zinc-600 dark:text-zinc-400">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
            {t("statsCaption")}
          </p>
        </div>
      </section>

      {/* ── Product suite — the comprehensive-solution showcase ─ */}
      <section id="products" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading title={t("suiteTitle")} subtitle={t("suiteSubtitle")} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SUITE.map(({ ns, Icon }) => (
            <Link
              key={ns}
              href={PRODUCT_HREFS[ns]}
              className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{m(`${ns}.name`)}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {m(`${ns}.tag`)}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 transition-colors group-hover:text-blue-600 dark:text-zinc-400 dark:group-hover:text-blue-400">
                {m("common.learnMore")}
                <ArrowEndIcon className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section
        id="features"
        className="scroll-mt-20 border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <SectionHeading title={t("featuresTitle")} subtitle={t("featuresSubtitle")} />

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  <f.Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {f.desc}
                </p>
              </div>
            ))}

            {/* Highlighted Gulf killer feature — spans full width */}
            <Link
              href={PRODUCT_HREFS.connect}
              className="relative overflow-hidden rounded-2xl border border-blue-300 bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white shadow-lg transition-shadow hover:shadow-xl sm:col-span-2 lg:col-span-3 dark:border-blue-700"
            >
              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
                <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                  <WhatsappIcon className="h-8 w-8" />
                </span>
                <div className="flex-1">
                  <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                    {t("f7Badge")}
                  </span>
                  <h3 className="mt-3 text-2xl font-bold">{t("f7Title")}</h3>
                  <p className="mt-2 max-w-2xl leading-relaxed text-blue-50">{t("f7Desc")}</p>
                </div>
                <ArrowEndIcon className="hidden h-6 w-6 shrink-0 text-blue-100 sm:block" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works — the loop ─────────────────────────── */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading title={t("howTitle")} subtitle={t("howSubtitle")} />
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s) => (
            <StepItem key={s.n} n={s.n} title={s.title} desc={s.desc} />
          ))}
        </div>
      </section>

      {/* ── Differentiators ─────────────────────────────────── */}
      <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <h2 className="mx-auto max-w-2xl text-center text-3xl font-bold tracking-tight sm:text-4xl">
            {t("diffTitle")}
          </h2>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {diffs.map((d) => (
              <div
                key={d.title}
                className="rounded-2xl border border-zinc-200 bg-white p-7 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  <d.Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-xl font-semibold">{d.title}</h3>
                <p className="mt-2 leading-relaxed text-zinc-600 dark:text-zinc-400">{d.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industries ──────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading title={t("industriesTitle")} subtitle={t("industriesSubtitle")} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {industries.map((i) => (
            <div
              key={i.title}
              className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <i.Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{i.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {i.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Proof / results ─────────────────────────────────── */}
      <section
        id="results"
        className="scroll-mt-20 border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <h2 className="mx-auto max-w-2xl text-center text-3xl font-bold tracking-tight sm:text-4xl">
            {t("proofTitle")}
          </h2>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {proofs.map((p) => (
              <div
                key={p.org}
                className="flex flex-col rounded-2xl border border-zinc-200 bg-zinc-50 p-7 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <CheckIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                <p className="mt-4 flex-1 leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {p.desc}
                </p>
                <p className="mt-5 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  {p.org}
                </p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
            {t("proofCaption")}
          </p>
        </div>
      </section>

      {/* ── Trust band ──────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading title={t("trustTitle")} />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <item.Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/security"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {t("trustLink")}
            <ArrowEndIcon className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────── */}
      <CtaBand title={t("ctaTitle")} subtitle={t("ctaSubtitle")} />
    </>
  );
}
