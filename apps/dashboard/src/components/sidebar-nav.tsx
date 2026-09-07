"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { NavIcon } from "./nav-icons";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const isActive = (it: NavItem) =>
    it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`);

  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100",
            ].join(" ")}
          >
            {/* Active indicator bar on the inline-start edge (RTL-safe). */}
            <span
              aria-hidden="true"
              className={[
                "absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500 transition-opacity",
                active ? "opacity-100" : "opacity-0",
              ].join(" ")}
            />
            <NavIcon
              name={item.icon}
              className={
                active ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 dark:text-zinc-500"
              }
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
