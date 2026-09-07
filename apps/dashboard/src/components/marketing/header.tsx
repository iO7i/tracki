import { LocaleSwitcher } from "@/components/locale-switcher";
import { ChevronDownIcon } from "@/components/marketing/chevron";
import { PRODUCT_HREFS, type ProductNs, primaryCta } from "@/components/marketing/sections";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

const navLink =
  "text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

const PRODUCT_MENU: ProductNs[] = ["web", "mobile", "agent", "connect", "voc", "knowledge"];

/**
 * Shared marketing-site header. The Products dropdown is CSS-only
 * (hover + focus-within) so the whole header stays a server component.
 */
export async function MarketingHeader() {
  const t = await getTranslations("mkt");
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-zinc-50/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-blue-600 dark:text-blue-400"
          >
            Tracki
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {/* Products dropdown */}
            <div className="group relative">
              <button type="button" className={`${navLink} inline-flex items-center gap-1 py-5`}>
                {t("nav.products")}
                <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
              </button>
              <div className="invisible absolute start-0 top-full w-80 -translate-y-1 rounded-2xl border border-zinc-200 bg-white p-2 opacity-0 shadow-lg transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-zinc-800 dark:bg-zinc-900">
                {PRODUCT_MENU.map((ns) => (
                  <Link
                    key={ns}
                    href={PRODUCT_HREFS[ns]}
                    className="block rounded-xl px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {t(`${ns}.name`)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t(`${ns}.tag`)}
                    </span>
                  </Link>
                ))}
                <div className="mx-2 my-1 border-t border-zinc-100 dark:border-zinc-800" />
                <Link
                  href={PRODUCT_HREFS.platform}
                  className="block rounded-xl px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span className="block text-sm font-semibold text-blue-700 dark:text-blue-400">
                    {t("platform.name")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {t("platform.tag")}
                  </span>
                </Link>
              </div>
            </div>

            <Link href="/platform" className={navLink}>
              {t("nav.platform")}
            </Link>
            <Link href="/pricing" className={navLink}>
              {t("nav.pricing")}
            </Link>
            <Link href="/security" className={navLink}>
              {t("nav.security")}
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LocaleSwitcher />
          {user ? (
            <Link href="/orgs" className={`${primaryCta} px-4 py-2`}>
              {t("nav.dashboard")}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 sm:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {t("nav.signIn")}
              </Link>
              <Link href="/signup" className={`${primaryCta} px-4 py-2`}>
                {t("nav.start")}
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
