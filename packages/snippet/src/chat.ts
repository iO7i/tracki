import type { EventQueue } from "./queue";
import { getAnonId, getSessionId, getUserId } from "./storage";

interface ChatReply {
  conversationId: string;
  reply: string;
  citation?: { articleId: string; title: string };
  escalate: boolean;
}

function lang(): "ar" | "en" {
  const l = (document.documentElement.lang || "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("en")) return "en";
  return document.documentElement.dir === "rtl" ? "ar" : "en";
}

const STR = {
  ar: {
    title: "المساعدة",
    placeholder: "اكتب سؤالك…",
    send: "إرسال",
    source: "المصدر",
    talk: "تحدّث إلى ممثّل",
    queued: "تم استلام طلبك — سيتواصل معك أحد ممثّلينا قريباً.",
  },
  en: {
    title: "Help",
    placeholder: "Type your question…",
    send: "Send",
    source: "Source",
    talk: "Talk to a person",
    queued: "Got it — a team member will reach out to you shortly.",
  },
};

/**
 * Tracki Agent chat widget (implementation). Multi-turn, grounded; posts to /v1/chat.
 * textContent-only render, RTL by page dir, fail-silent. A launcher bubble opens
 * the panel; `tracki.chat()` opens it programmatically.
 */
export function createChatWidget(chatUrl: string, key: string, queue?: EventQueue) {
  const handoffUrl = chatUrl.replace(/\/v1\/chat$/, "/v1/handoff");
  let conversationId: string | undefined;
  let panel: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;

  const L = () => lang();
  const t = () => STR[L()];

  const ctx = () => ({
    path: location.pathname + location.search,
    url: location.href,
    referrer: document.referrer || undefined,
  });

  function addMsg(
    role: "user" | "assistant",
    text: string,
    citation?: ChatReply["citation"],
  ): void {
    if (!listEl) return;
    const row = document.createElement("div");
    row.style.cssText = `margin-block-end:10px;display:flex;${role === "user" ? "justify-content:flex-end" : "justify-content:flex-start"};`;
    const bubble = document.createElement("div");
    bubble.textContent = text; // textContent → no injection
    bubble.style.cssText = `max-inline-size:80%;padding:8px 12px;border-radius:12px;font-size:14px;white-space:pre-wrap;${
      role === "user" ? "background:#2563eb;color:#fff;" : "background:#f1f1f4;color:#111827;"
    }`;
    row.appendChild(bubble);
    if (citation) {
      const cite = document.createElement("div");
      cite.textContent = `${t().source}: ${citation.title}`;
      cite.style.cssText = "font-size:11px;opacity:.6;margin-block-start:2px;";
      bubble.appendChild(cite);
    }
    listEl.appendChild(row);
    listEl.scrollTop = listEl.scrollHeight;
  }

  async function send(input: HTMLInputElement): Promise<void> {
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    addMsg("user", message);
    try {
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        mode: "cors",
        credentials: "omit",
        body: JSON.stringify({
          key,
          anonId: getAnonId(),
          userId: getUserId(),
          sessionId: getSessionId(),
          conversationId,
          message,
          path: location.pathname + location.search,
        }),
      });
      const data = (await res.json()) as ChatReply;
      if (data.conversationId) conversationId = data.conversationId;
      addMsg("assistant", data.reply, data.citation);
      if (data.escalate) {
        const cta = document.createElement("button");
        cta.textContent = t().talk;
        cta.style.cssText =
          "margin-block-end:10px;background:#111827;color:#fff;border:0;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;";
        // implementation: hand off to WhatsApp with the full web context (inquiry
        // code + wa.me deep link). Falls back to intent-capture if unavailable.
        cta.addEventListener("click", async () => {
          queue?.enqueue({
            type: "track" as never,
            ts: Date.now(),
            ...ctx(),
            props: { name: "agent_escalate_clicked", conversationId },
          });
          cta.remove();
          // Popup-blocker-safe: open the tab synchronously in the click gesture,
          // navigate it on the handoff response, close it on failure.
          const tab = window.open("about:blank", "_blank");
          if (tab) tab.opener = null;
          try {
            const res = await fetch(handoffUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              mode: "cors",
              credentials: "omit",
              body: JSON.stringify({
                key,
                anonId: getAnonId(),
                sessionId: getSessionId(),
                conversationId,
                path: location.pathname + location.search,
                locale: L(),
              }),
            });
            const data = (await res.json()) as { deepLink?: string };
            if (data.deepLink && /^https:\/\//i.test(data.deepLink)) {
              if (tab) tab.location.href = data.deepLink;
              else window.open(data.deepLink, "_blank", "noopener");
              return;
            }
            tab?.close();
          } catch {
            tab?.close();
          }
          addMsg("assistant", t().queued);
        });
        listEl?.appendChild(cta);
      }
    } catch {
      /* fail-silent */
    }
  }

  function open(): void {
    if (panel) {
      panel.style.display = "flex";
      return;
    }
    const dir = L() === "ar" ? "rtl" : "ltr";
    panel = document.createElement("div");
    panel.setAttribute("dir", dir);
    panel.style.cssText =
      "position:fixed;inset-block-end:84px;inset-inline-end:20px;z-index:2147483646;inline-size:340px;max-block-size:70vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:system-ui,sans-serif;overflow:hidden;";

    const head = document.createElement("div");
    head.textContent = t().title;
    head.style.cssText =
      "background:#2563eb;color:#fff;padding:12px 16px;font-weight:700;font-size:15px;";

    listEl = document.createElement("div");
    listEl.style.cssText = "flex:1;overflow:auto;padding:14px;min-block-size:160px;";

    const form = document.createElement("form");
    form.style.cssText = "display:flex;gap:8px;padding:10px;border-block-start:1px solid #eee;";
    const input = document.createElement("input");
    input.placeholder = t().placeholder;
    input.style.cssText =
      "flex:1;border:1px solid #d4d4d8;border-radius:10px;padding:8px 12px;font:inherit;font-size:14px;";
    const btn = document.createElement("button");
    btn.type = "submit";
    btn.textContent = t().send;
    btn.style.cssText =
      "background:#2563eb;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer;";
    form.append(input, btn);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void send(input);
    });

    panel.append(head, listEl, form);
    document.body.appendChild(panel);
    input.focus();
  }

  function mountLauncher(): void {
    const bubble = document.createElement("button");
    bubble.setAttribute("aria-label", "chat");
    bubble.textContent = "💬";
    bubble.style.cssText =
      "position:fixed;inset-block-end:20px;inset-inline-end:20px;z-index:2147483645;inline-size:52px;block-size:52px;border-radius:50%;background:#2563eb;color:#fff;border:0;font-size:22px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2);";
    bubble.addEventListener("click", () => open());
    document.body.appendChild(bubble);
  }

  return { open, mountLauncher };
}
