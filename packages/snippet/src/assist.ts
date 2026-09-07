import type { ChannelHandlers, CtaLike } from "./cta";
import type { EventQueue } from "./queue";

interface AssistContent {
  title: string;
  body: string;
  cta?: CtaLike;
}
interface AssistPayload {
  actionId: string;
  mode: "answer" | "fallback";
  confidence: number;
  content: { ar: AssistContent; en: AssistContent };
  article?: { ar: { title: string; body: string }; en: { title: string; body: string } };
  articleId?: string;
}

function lang(): "ar" | "en" {
  const l = (document.documentElement.lang || "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("en")) return "en";
  return document.documentElement.dir === "rtl" ? "ar" : "en";
}

/**
 * Renders server-driven Live Assist (implementation). Answer mode shows the
 * contextually-matched FAQ inline + "was this helpful?"; fallback mode shows the
 * action's authored message + escalate CTA. textContent only; once per session
 * per action; fail-silent. implementation: the escalate CTA routes by channel —
 * explicit kinds open faq/chat/whatsapp exactly; a legacy `faq:true` (no kind)
 * keeps its audited implementation escalation semantics (opens the Agent chat).
 */
export function createAssistRenderer(queue: EventQueue, handlers: ChannelHandlers = {}) {
  const shown = new Set<string>();

  const ctx = () => ({
    path: location.pathname + location.search,
    url: location.href,
    referrer: document.referrer || undefined,
  });
  const emit = (type: string, payload: AssistPayload) =>
    queue.enqueue({
      type: type as never,
      ts: Date.now(),
      ...ctx(),
      props: { action_id: payload.actionId, article_id: payload.articleId, mode: payload.mode },
    });

  function show(payload: AssistPayload): void {
    if (!payload || shown.has(payload.actionId)) return;
    const L = lang();
    const dir = L === "ar" ? "rtl" : "ltr";
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

    try {
      const root = document.createElement("div");
      root.setAttribute("dir", dir);
      root.style.cssText =
        "position:fixed;inset-block-end:16px;inset-inline-end:16px;z-index:2147483645;max-inline-size:340px;background:#fff;color:#111827;border-radius:14px;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.22);font-family:system-ui,sans-serif;";

      const h = document.createElement("div");
      h.textContent = title;
      h.style.cssText = "font-weight:700;font-size:15px;margin-block-end:6px;";
      const b = document.createElement("div");
      b.textContent = body;
      b.style.cssText =
        "font-size:14px;opacity:.85;white-space:pre-wrap;max-block-size:200px;overflow:auto;";

      const close = document.createElement("button");
      close.textContent = "✕";
      close.setAttribute("aria-label", "close");
      close.style.cssText =
        "position:absolute;inset-block-start:10px;inset-inline-end:12px;background:none;border:0;font-size:15px;cursor:pointer;color:inherit;";
      close.addEventListener("click", () => root.remove());

      const row = document.createElement("div");
      row.style.cssText =
        "margin-block-start:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;";

      if (payload.mode === "answer") {
        const q = document.createElement("span");
        q.textContent = L === "ar" ? "هل كان هذا مفيداً؟" : "Was this helpful?";
        q.style.cssText = "font-size:13px;opacity:.7;";
        const yes = document.createElement("button");
        yes.textContent = L === "ar" ? "نعم" : "Yes";
        const no = document.createElement("button");
        no.textContent = L === "ar" ? "لا" : "No";
        for (const x of [yes, no])
          x.style.cssText =
            "border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:4px 12px;cursor:pointer;font:inherit;font-size:13px;";
        yes.addEventListener("click", () => {
          emit("assist_helpful", payload);
          yes.textContent = "✓";
        });
        no.addEventListener("click", () => {
          emit("assist_unhelpful", payload);
          // Offer escalation to the Agent when the answer didn't help.
          handlers.openChat?.();
        });
        row.append(q, yes, no);
      }

      // Escalate CTA from the action's authored content, routed by channel.
      const cta = authored.cta;
      if (cta?.label) {
        const useAnchor = !cta.kind && !cta.faq && !!cta.url;
        const btn = document.createElement(useAnchor ? "a" : "button");
        btn.textContent = cta.label;
        btn.style.cssText =
          "background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit;font-size:13px;text-decoration:none;";
        if (useAnchor && cta.url && /^https?:\/\//i.test(cta.url)) {
          (btn as HTMLAnchorElement).href = cta.url;
          (btn as HTMLAnchorElement).rel = "noopener";
        }
        btn.addEventListener("click", () => {
          emit("assist_escalate", payload);
          if (cta.kind === "faq") handlers.openFaq?.();
          else if (cta.kind === "chat") handlers.openChat?.();
          else if (cta.kind === "whatsapp") handlers.openWhatsApp?.();
          // Legacy implementation shape (faq:true, no kind): escalate to the Agent.
          else if (cta.faq) handlers.openChat?.();
          root.remove();
        });
        row.append(btn);
      }

      root.append(close, h, b, row);
      document.body.append(root);
      emit("assist_shown", payload);
    } catch {
      /* fail-silent */
    }
  }

  return { show };
}
