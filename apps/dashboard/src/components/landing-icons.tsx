import type { SVGProps } from "react";

/**
 * Minimal line-icon set for the marketing landing page (no icon dependency).
 * Each inherits `currentColor`; pass `className` for size/color. Direction-
 * neutral so they render identically in RTL and LTR.
 */
const base: SVGProps<SVGSVGElement> = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

type IconProps = { className?: string };

export function MobileIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

export function ActivityIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function CursorIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M5 3l6.5 16 2-6.5L20 10.5 5 3Z" />
    </svg>
  );
}

export function BookIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Z" />
      <path d="M18 17H6a2 2 0 0 0-2 2" />
    </svg>
  );
}

export function SparklesIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
      <path d="M19 14l.8 2 .2.8-2-.8L18 14l1 0Z" />
    </svg>
  );
}

export function ChatIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M8.5 11h7M8.5 14h4" />
    </svg>
  );
}

export function WhatsappIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M3 21l1.8-5.3A8.4 8.4 0 1 1 8.3 19L3 21Z" />
      <path d="M8.6 8.2c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3c-.3.3-.9.8-.9 2s.9 2.3 1 2.5c.1.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7s1.5-.6 1.7-1.2c.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.6-.4l-1.6-.8c-.2-.1-.4-.1-.6.1l-.7.9c-.1.2-.3.2-.5.1a6 6 0 0 1-1.8-1.1 7 7 0 0 1-1.2-1.6c-.1-.2 0-.3.1-.4l.4-.5c.1-.2.1-.3.2-.5s0-.3 0-.5l-.7-1.8Z" />
    </svg>
  );
}

export function GlobeIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function LayersIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17.5 9 5 9-5" strokeOpacity="0.45" />
    </svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

export function ServerIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="7" rx="1.5" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

export function ChartIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <path d="M8.5 15.5v-4M13 15.5V8M17.5 15.5v-6.5" />
    </svg>
  );
}

export function LightbulbIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M9.5 17a6.5 6.5 0 1 1 5 0c-.4.3-.5.8-.5 1.2V19a2 2 0 0 1-4 0v-.8c0-.4-.1-.9-.5-1.2Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function ClipboardIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5a2 2 0 0 1 6 0" />
      <path d="m8.8 13 2 2 4-4" />
    </svg>
  );
}

export function RouteIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <circle cx="6" cy="18.5" r="2.5" />
      <circle cx="18" cy="5.5" r="2.5" />
      <path d="M8.5 18.5h6a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7" strokeOpacity="0.9" />
    </svg>
  );
}

export function EyeOffIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M3 12s3.2-6 9-6c1.3 0 2.5.3 3.5.8M21 12s-3.2 6-9 6c-1.3 0-2.5-.3-3.5-.8" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function LandmarkIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M4 9.5 12 4l8 5.5" />
      <path d="M5.5 9.5V18M9.8 9.5V18M14.2 9.5V18M18.5 9.5V18" />
      <path d="M3.5 20.5h17" />
    </svg>
  );
}

export function SignalIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M5 12.5a9.9 9.9 0 0 1 14 0" />
      <path d="M8 15.7a5.4 5.4 0 0 1 8 0" />
      <path d="M12 19h.01" />
    </svg>
  );
}

export function CartIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M3.5 4.5h2l2.3 11h10.5l2.2-8H7" />
      <circle cx="9.5" cy="19.5" r="1.6" />
      <circle cx="16.5" cy="19.5" r="1.6" />
    </svg>
  );
}

export function BuildingIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M9 7.5h2m2 0h2M9 11.5h2m2 0h2M9 15.5h2m2 0h2" />
      <path d="M3.5 20.5h17" />
    </svg>
  );
}

export function PlaneIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <path d="M10.5 13.5 4 11l1.5-1.5L11 10l4.5-4.5a1.8 1.8 0 0 1 2.5 2.5L13.5 12l.5 5.5L12.5 19l-2-6.5Z" />
      <path d="M5 19l2-2" />
    </svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <svg {...base} className={p.className} aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.8M17.5 14.4a5.5 5.5 0 0 1 3 5.1" />
    </svg>
  );
}

/** Direction-aware "forward" arrow — flips in RTL via CSS at the usage site. */
export function ArrowEndIcon(p: IconProps) {
  return (
    <svg {...base} className={`rtl:-scale-x-100 ${p.className ?? ""}`} aria-hidden="true">
      <path d="M4 12h16" />
      <path d="m14 6 6 6-6 6" />
    </svg>
  );
}
