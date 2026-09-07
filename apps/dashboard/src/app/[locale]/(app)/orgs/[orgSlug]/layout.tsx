import { type NavItem, SidebarNav } from "@/components/sidebar-nav";
import { requireMembership } from "@/lib/tenancy";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; orgSlug: string }>;
}) {
  const { locale, orgSlug } = await params;
  const { org } = await requireMembership(locale, orgSlug);
  const t = await getTranslations("nav");

  const items: NavItem[] = [
    { href: `/orgs/${orgSlug}`, label: t("projects"), icon: "projects", exact: true },
    { href: `/orgs/${orgSlug}/live`, label: t("liveView"), icon: "live" },
    { href: `/orgs/${orgSlug}/struggles`, label: t("struggles"), icon: "struggles" },
    { href: `/orgs/${orgSlug}/segments`, label: t("segments"), icon: "segments" },
    { href: `/orgs/${orgSlug}/actions`, label: t("actions"), icon: "actions" },
    { href: `/orgs/${orgSlug}/mobile`, label: t("mobile"), icon: "mobile" },
    { href: `/orgs/${orgSlug}/revenue`, label: t("revenue"), icon: "revenue" },
    { href: `/orgs/${orgSlug}/vertex`, label: t("vertex"), icon: "vertex" },
    { href: `/orgs/${orgSlug}/faq`, label: t("faq"), icon: "faq" },
    { href: `/orgs/${orgSlug}/agent`, label: t("agent"), icon: "agent" },
    { href: `/orgs/${orgSlug}/inbox`, label: t("inbox"), icon: "inbox" },
    { href: `/orgs/${orgSlug}/voc`, label: t("voc"), icon: "voc" },
    { href: `/orgs/${orgSlug}/knowledge`, label: t("knowledge"), icon: "knowledge" },
    { href: `/orgs/${orgSlug}/settings`, label: t("settings"), icon: "settings" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6">
      <aside className="w-56 shrink-0">
        <div className="sticky top-20">
          <div className="mb-3 flex items-center gap-2.5 px-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
              aria-hidden="true"
            >
              {org.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {org.name}
            </span>
          </div>
          <SidebarNav items={items} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 animate-rise">{children}</main>
    </div>
  );
}
