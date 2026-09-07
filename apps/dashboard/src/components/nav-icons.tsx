import type { ReactNode, SVGProps } from "react";

/** Line icons for the app sidebar (dependency-free, direction-neutral). */
const base: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const paths: Record<string, ReactNode> = {
  projects: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  live: <path d="M3 12h4l2 6 4-14 2.5 8H21" />,
  struggles: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  segments: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  actions: <path d="M5 3l6.5 16 2-6.5L20 10.5 5 3Z" />,
  revenue: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.6 9.3A3 3 0 0 0 12 8c-1.5 0-2.6.8-2.6 2s1 1.6 2.6 2 2.6.9 2.6 2-1.1 2-2.6 2a3 3 0 0 1-2.6-1.3M12 6.4v1.6M12 16v1.6" />
    </>
  ),
  mobile: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  vertex: (
    <>
      <path d="M3 4h18M5.5 8h13M8 12h8M10 16h4M11 20h2" />
    </>
  ),
  faq: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Z" />
      <path d="M18 17H6a2 2 0 0 0-2 2" />
    </>
  ),
  agent: (
    <>
      <path d="M12 3l1.8 4.4L18 9.2l-4.2 1.8L12 15l-1.8-4L6 9.2l4.2-1.8L12 3Z" />
      <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14Z" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 21l1.8-5.3A8.4 8.4 0 1 1 8.3 19L3 21Z" />
      <path d="M8.5 11h7M8.5 14h4" />
    </>
  ),
  voc: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15 8.5a3.5 3.5 0 0 1 0 7M18 5a7 7 0 0 1 0 14" />
    </>
  ),
  knowledge: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v.3h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1Z" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      {paths[name] ?? paths.projects}
    </svg>
  );
}
