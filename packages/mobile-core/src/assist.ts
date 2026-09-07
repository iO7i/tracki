import type { CtaRouter } from "./cta";
import { ctaKind } from "./cta";
import type { EventQueue } from "./queue";
import type { AssistIntent, Clock, Renderer } from "./types";

interface AssistContentWire {
  title: string;
  body: string;
  cta?: { label: string; kind?: string; url?: string; faq?: boolean };
}
interface AssistPayload {
  actionId: string;
  mode: "answer" | "fallback";
  confidence: number;
  content: { ar: AssistContentWire; en: AssistContentWire };
  article?: { ar: { title: string; body: string }; en: { title: string; body: string } };
  articleId?: string;
}

interface AssistDeps {
  locale: () => "ar" | "en";
  currentPath: () => string;
  queue: EventQueue;
  renderer?: Renderer;
  cta: CtaRouter;
  now: Clock;
}

/**
 * Server-driven Live Assist, mobile edition (implementation mechanism unchanged):
 * the worker matched a struggle to an action + FAQ and stashed the payload;
 * it arrives on an event-flush response and renders as a contextual drawer.
 * Once per session per action; fail-silent.
 */
export function createAssistHandler(deps: AssistDeps) {
  const shown = new Set<string>();

  const emit = (type: string, p: AssistPayload) =>
    deps.queue.enqueue({
      type,
      ts: deps.now(),
      path: deps.currentPath(),
      props: { action_id: p.actionId, article_id: p.articleId, mode: p.mode },
    });

  function show(payload: AssistPayload): void {
    if (!deps.renderer || !payload || shown.has(payload.actionId)) return;
    const L = deps.locale();
    const authored = payload.content[L] ?? payload.content.ar;
    let title = authored.title;
    let body = authored.body;
    if (payload.mode === "answer" && payload.article) {
      const a = payload.article[L]?.title ? payload.article[L] : payload.article.ar;
      title = a.title;
      body = a.body;
    }
    if (!title && !body) return;
    shown.add(payload.actionId);

    const cta = authored.cta;
    const intent: AssistIntent = {
      intent: "assist",
      actionId: payload.actionId,
      mode: payload.mode,
      title,
      body,
      ctaLabel: cta?.label,
      helpful: () => emit("assist_helpful", payload),
      unhelpful: () => {
        emit("assist_unhelpful", payload);
        // Parity with the snippet: an unhelpful answer offers the Agent.
        deps.cta.openChat();
      },
      escalate: () => {
        emit("assist_escalate", payload);
        if (cta) {
          const kind = ctaKind(cta);
          if (kind === "url") {
            deps.cta.activate(cta);
          } else if (kind === "faq" && cta.kind === "faq") {
            deps.cta.openFaq();
          } else if (kind === "whatsapp") {
            deps.cta.openWhatsApp();
          } else {
            // chat — and the legacy implementation shape (faq:true, no kind), which
            // keeps its audited semantics of escalating to the Agent.
            deps.cta.openChat();
          }
        }
      },
    };
    try {
      deps.renderer.show(intent);
      emit("assist_shown", payload);
    } catch {
      /* fail-silent */
    }
  }

  /** Wire as the queue's response handler. */
  function onResponse(data: unknown): void {
    const assist = (data as { assist?: AssistPayload } | undefined)?.assist;
    if (assist) show(assist);
  }

  return { show, onResponse };
}
