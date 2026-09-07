"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  // Audit N1: next-intl usePathname drops search params — re-append them so
  // switching language preserves ?next=… on login/invite pages.
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const t = useTranslations("localeSwitcher");
  const other = locale === "ar" ? "en" : "ar";

  // No aria-label: the visible language name IS the accessible name.
  return (
    <button
      type="button"
      onClick={() => router.replace(query ? `${pathname}?${query}` : pathname, { locale: other })}
      lang={other}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      {t("switchTo")}
    </button>
  );
}
