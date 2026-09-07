import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { isStaff } from "@/lib/tenancy";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations("common");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/orgs" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white shadow-sm shadow-blue-600/30">
              T
            </span>
            <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t("appName")}
            </span>
          </Link>

          <div className="flex items-center gap-1.5">
            {isStaff(user.email) ? (
              <Link
                href="/admin/leads"
                className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 sm:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {t("admin")}
              </Link>
            ) : null}
            <ThemeToggle />
            <LocaleSwitcher />
            <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex items-center gap-2 ps-1">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-semibold text-white"
                aria-hidden="true"
              >
                {initials(user.name)}
              </span>
              <span className="hidden text-sm font-medium text-zinc-700 sm:inline dark:text-zinc-300">
                {user.name}
              </span>
            </div>
            <form action={logoutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {t("logout")}
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
