import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (user) redirect(`/${locale}/orgs`);

  const t = await getTranslations("common");

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Soft brand glow behind the form. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(37,99,235,0.10),transparent_70%)]"
      />
      <header className="relative flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white shadow-sm shadow-blue-600/30">
            T
          </span>
          <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("appName")}
          </span>
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pb-20">
        <div className="w-full max-w-md animate-rise">{children}</div>
      </main>
    </div>
  );
}
