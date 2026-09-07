import type { ReactNode } from "react";

/** Consistent page title block: title + optional subtitle + optional actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Compact KPI tile. `accent` highlights the headline number in brand color. */
export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/70 dark:ring-1 dark:ring-white/5">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      <div
        className={[
          "mt-1.5 text-2xl font-bold tracking-tight tabular-nums",
          accent ? "text-blue-600 dark:text-blue-400" : "text-zinc-900 dark:text-zinc-50",
        ].join(" ")}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}
