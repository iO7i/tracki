import { LocaleSwitcher } from "@/components/locale-switcher";
import { PRODUCT_HREFS, type ProductNs } from "@/components/marketing/sections";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

const footerLink =
  "text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

const PRODUCT_COLUMN: ProductNs[] = [
  "web",
  "mobile",
  "agent",
  "connect",
  "voc",
  "knowledge",
  "platform",
];

/** Full sitemap footer shared by every marketing page. */
export async function MarketingFooter() {
  const t = await getTranslations("mkt");

  return (
    <footer className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <span className="text-lg font-bold text-blue-600 dark:text-blue-400">Tracki</span>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t("footer.tagline")}
          </p>
          <div className="mt-5">
            <LocaleSwitcher />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("footer.colProducts")}
          </h3>
          <ul className="mt-4 space-y-2.5">
            {PRODUCT_COLUMN.map((ns) => (
              <li key={ns}>
                <Link href={PRODUCT_HREFS[ns]} className={footerLink}>
                  {t(`${ns}.name`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("footer.colCompany")}
          </h3>
          <ul className="mt-4 space-y-2.5">
            <li>
              <Link href="/demo" className={footerLink}>
                {t("common.demo")}
              </Link>
            </li>
            <li>
              <Link href="/pricing" className={footerLink}>
                {t("nav.pricing")}
              </Link>
            </li>
            <li>
              <Link href="/security" className={footerLink}>
                {t("nav.security")}
              </Link>
            </li>
            <li>
              <Link href="/login" className={footerLink}>
                {t("nav.signIn")}
              </Link>
            </li>
            <li>
              <Link href="/signup" className={footerLink}>
                {t("nav.start")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-zinc-100 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        {t("footer.rights")}
      </p>
    </footer>
  );
}
