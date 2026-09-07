import type { EventQueue } from "./queue";
import type { ChatIntent, CtaContent, FaqIntent, Renderer, Transport } from "./types";

export type CtaKind = "url" | "faq" | "chat" | "whatsapp";

/** Effective channel, tolerating pre-implementation shapes (faq boolean / url-only). */
export function ctaKind(cta: CtaContent): CtaKind {
  if (cta.kind === "faq" || cta.kind === "chat" || cta.kind === "whatsapp" || cta.kind === "url") {
    return cta.kind;
  }
  return cta.faq ? "faq" : "url";
}

interface RouterDeps {
  key: string;
  endpoint: string;
  locale: () => "ar" | "en";
  /** Device platform stamped on handoffs so the inbox can label the surface. */
  platform: () => "ios" | "android";
  currentPath: () => string;
  queue: EventQueue;
  transport: Transport;
  renderer?: Renderer;
  openUrl?: (url: string) => void;
  identity: { getAnonId(): string; currentSession(): string; getUserId(): string | undefined };
  now: () => number;
}

interface FaqArticle {
  id: string;
  title: string;
  body: string;
}

/**
 * Channel router (implementation "right channeling", mobile edition): a CTA opens a
 * URL, the FAQ help center, the grounded Agent chat, or a WhatsApp handoff —
 * all against the existing public APIs. Fail-silent throughout.
 */
export function createCtaRouter(deps: RouterDeps) {
  async function searchFaq(query: string): Promise<FaqArticle[]> {
    try {
      const data = (await deps.transport.get(
        `${deps.endpoint}/v1/faq?key=${encodeURIComponent(deps.key)}&q=${encodeURIComponent(query)}`,
      )) as { articles?: FaqArticle[] } | undefined;
      return Array.isArray(data?.articles) ? data.articles : [];
    } catch {
      return [];
    }
  }

  function openFaq(): void {
    if (!deps.renderer) return;
    void searchFaq("").then((articles) => {
      const intent: FaqIntent = { intent: "faq", articles, search: searchFaq };
      deps.renderer?.show(intent);
    });
  }

  function openChat(): void {
    if (!deps.renderer) return;
    let conversationId: string | undefined;
    const intent: ChatIntent = {
      intent: "chat",
      send: async (message: string) => {
        try {
          const data = (await deps.transport.post(`${deps.endpoint}/v1/chat`, {
            key: deps.key,
            anonId: deps.identity.getAnonId(),
            sessionId: deps.identity.currentSession(),
            userId: deps.identity.getUserId(),
            conversationId,
            message,
            path: deps.currentPath(),
          })) as { conversationId?: string; reply?: string; escalate?: boolean } | undefined;
          if (data?.conversationId) conversationId = data.conversationId;
          return { reply: data?.reply ?? "", escalate: data?.escalate ?? false };
        } catch {
          return { reply: "", escalate: true };
        }
      },
    };
    deps.renderer.show(intent);
  }

  /** Mint a implementation handoff and open the wa.me deep link (the ME killer flow). */
  function openWhatsApp(): void {
    void deps.transport
      .post(`${deps.endpoint}/v1/handoff`, {
        key: deps.key,
        anonId: deps.identity.getAnonId(),
        sessionId: deps.identity.currentSession(),
        path: deps.currentPath(),
        locale: deps.locale(),
        platform: deps.platform(),
      })
      .then((data) => {
        const link = (data as { deepLink?: string } | undefined)?.deepLink;
        if (link && /^https:\/\//i.test(link)) deps.openUrl?.(link);
      })
      .catch(() => {});
  }

  /** Route a CTA tap to its channel. Returns the resolved kind (for telemetry). */
  function activate(cta: CtaContent): CtaKind {
    const kind = ctaKind(cta);
    if (kind === "url") {
      if (cta.url && /^https?:\/\//i.test(cta.url)) deps.openUrl?.(cta.url);
    } else if (kind === "faq") {
      openFaq();
    } else if (kind === "chat") {
      openChat();
    } else {
      openWhatsApp();
    }
    return kind;
  }

  return { activate, openFaq, openChat, openWhatsApp, searchFaq };
}

export type CtaRouter = ReturnType<typeof createCtaRouter>;
