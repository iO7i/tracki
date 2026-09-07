import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import type { ReactNode } from "react";

/** Shared chrome for every marketing page: sticky header + sitemap footer. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}
