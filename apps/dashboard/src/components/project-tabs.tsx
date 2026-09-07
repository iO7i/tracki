import { Link } from "@/i18n/navigation";

export interface ProjectTabItem {
  name: string;
  slug: string;
}

/**
 * Segmented project switcher used on every project-scoped page. Server
 * component (active state is resolved server-side); RTL-safe.
 */
export function ProjectTabs({
  items,
  activeSlug,
  basePath,
}: {
  items: ProjectTabItem[];
  activeSlug?: string;
  basePath: string;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200/80 bg-white p-1 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/70">
      {items.map((p) => {
        const active = p.slug === activeSlug;
        return (
          <Link
            key={p.slug}
            href={{ pathname: basePath, query: { project: p.slug } }}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }
          >
            {p.name}
          </Link>
        );
      })}
    </div>
  );
}
