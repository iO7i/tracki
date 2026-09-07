import type { ReactElement, SVGProps } from "react";

/**
 * Shared visual language for the struggles surface: a line icon per struggle
 * type, a single severity color system (so the overview band, the live feed,
 * and the report all read consistently), and a compact friction-score meter.
 * Dep-free inline SVG; RTL-safe (no left/right, only currentColor + logical use).
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

function RageIcon(p: IconProps) {
  return (
    <svg {...base(p)} aria-hidden="true">
      <path d="M9 11.5 6.5 4 14 7" />
      <path d="m13 13 8 3-4 1.5L15 21l-3-8" />
      <path d="M5 8.5 3 9M8 5 7 3M11.5 6 12 4" />
    </svg>
  );
}
function DeadIcon(p: IconProps) {
  return (
    <svg {...base(p)} aria-hidden="true">
      <path d="M9 11.5 6.5 4 14 7l-3 2 3 7" />
      <circle cx="17" cy="7" r="4" />
      <path d="m14.5 9.5 5-5" />
    </svg>
  );
}
function ErrorIcon(p: IconProps) {
  return (
    <svg {...base(p)} aria-hidden="true">
      <path d="M10.3 4.3 2.5 18a1.5 1.5 0 0 0 1.3 2.2h16.4a1.5 1.5 0 0 0 1.3-2.2L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
function SubmitIcon(p: IconProps) {
  return (
    <svg {...base(p)} aria-hidden="true">
      <path d="M21 8a8 8 0 1 0 .5 5" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
function AbandonIcon(p: IconProps) {
  return (
    <svg {...base(p)} aria-hidden="true">
      <rect x="4" y="3" width="11" height="18" rx="2" />
      <path d="M8 8h3M8 12h3" />
      <path d="m16.5 14 3 2.5-3 2.5M13 16.5h6" />
    </svg>
  );
}
function ThrashIcon(p: IconProps) {
  return (
    <svg {...base(p)} aria-hidden="true">
      <path d="M3 12h3l2.5-7 4 16 2.5-9H21" />
    </svg>
  );
}

const ICONS: Record<string, (p: IconProps) => ReactElement> = {
  rage_click: RageIcon,
  dead_click: DeadIcon,
  repeated_error: ErrorIcon,
  repeated_submit: SubmitIcon,
  form_abandon: AbandonIcon,
  thrashing: ThrashIcon,
};

export function StruggleTypeIcon({ type, ...props }: { type: string } & IconProps) {
  const Icon = ICONS[type] ?? ErrorIcon;
  return <Icon {...props} />;
}

// ── Severity color system ──────────────────────────────────────────────────
export type Sev = "high" | "medium" | "low";

export function asSev(s: string): Sev {
  return s === "high" || s === "medium" ? s : "low";
}

interface SevStyle {
  /** soft tinted chip/circle background + text */
  soft: string;
  /** solid bar / dot fill */
  bar: string;
  /** inline-start accent border */
  border: string;
  /** text only */
  text: string;
}

export const SEV_STYLE: Record<Sev, SevStyle> = {
  high: {
    soft: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
    bar: "bg-rose-500",
    border: "border-rose-400 dark:border-rose-500/60",
    text: "text-rose-600 dark:text-rose-400",
  },
  medium: {
    soft: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    bar: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500/60",
    text: "text-amber-600 dark:text-amber-400",
  },
  low: {
    soft: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    bar: "bg-sky-500",
    border: "border-sky-300 dark:border-sky-500/50",
    text: "text-sky-600 dark:text-sky-400",
  },
};

/** Compact 0–100 friction meter: a thin track with a severity-colored fill. */
export function ScoreMeter({
  score,
  sev,
  label,
}: {
  score: number;
  sev: Sev;
  label?: string;
}) {
  const pct = Math.max(4, Math.min(100, score));
  return (
    <div className="flex items-center gap-2" title={label ? `${label}: ${score}` : String(score)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-700/60">
        <div
          className={`h-full rounded-full ${SEV_STYLE[sev].bar}`}
          style={{ inlineSize: `${pct}%` }}
        />
      </div>
      <span className="w-7 text-end text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
        {score}
      </span>
    </div>
  );
}
