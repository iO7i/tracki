import { getAnonId, getSessionId } from "./storage";

/**
 * Channel CTAs (slice 12 — "right channeling"): an action/assist CTA routes to
 * a channel — a URL, the FAQ widget, the Agent chat, or a WhatsApp handoff.
 * Zero-dep mirror of @tracki/shared's CTA types (shared/actions pulls zod).
 */

export interface CtaLike {
  label: string;
  url?: string;
  faq?: boolean;
  kind?: string;
}

export type SnippetCtaKind = "url" | "faq" | "chat" | "whatsapp";

/** Effective channel, tolerating pre-slice-12 shapes (faq boolean / url-only). */
export function ctaKind(cta: CtaLike): SnippetCtaKind {
  if (cta.kind === "faq" || cta.kind === "chat" || cta.kind === "whatsapp" || cta.kind === "url") {
    return cta.kind;
  }
  return cta.faq ? "faq" : "url";
}

/** Widget/channel openers wired in index.ts; all optional (fail-silent). */
export interface ChannelHandlers {
  openFaq?: () => void;
  openChat?: () => void;
  openWhatsApp?: () => void;
}

function lang(): "ar" | "en" {
  const l = (document.documentElement.lang || "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("en")) return "en";
  return document.documentElement.dir === "rtl" ? "ar" : "en";
}

/**
 * WhatsApp opener: mint a slice-7 handoff (inquiry code + masked web context,
 * server-side) and open the returned wa.me deep link — same flow the Agent's
 * escalate button uses (chat.ts). Fail-silent: a failed handoff opens nothing.
 */
export function createWhatsAppOpener(handoffUrl: string, key: string): () => void {
  return () => {
    // Popup-blocker-safe: open the tab synchronously inside the click gesture,
    // then navigate it once the async handoff resolves (close it on failure).
    // Sever `opener` manually since "noopener" would null the handle we need.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    fetch(handoffUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      mode: "cors",
      credentials: "omit",
      body: JSON.stringify({
        key,
        anonId: getAnonId(),
        sessionId: getSessionId(),
        path: location.pathname + location.search,
        locale: lang(),
      }),
    })
      .then((r) => r.json())
      .then((d: { deepLink?: string }) => {
        if (d?.deepLink && /^https:\/\//i.test(d.deepLink)) {
          if (tab) tab.location.href = d.deepLink;
          else window.open(d.deepLink, "_blank", "noopener");
        } else {
          tab?.close();
        }
      })
      .catch(() => {
        tab?.close(); // fail-silent: no broken navigation
      });
  };
}
