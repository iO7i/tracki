import type { EventQueue } from "./queue";

interface FaqArticle {
  id: string;
  slug: string;
  category: string;
  tags: string[];
  ar: { title: string; body: string };
  en: { title: string; body: string };
}

function lang(): "ar" | "en" {
  const l = (document.documentElement.lang || "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("en")) return "en";
  return document.documentElement.dir === "rtl" ? "ar" : "en";
}

/**
 * Embeddable FAQ widget (implementation). Opens a panel with Arabic-aware search over
 * the project's published articles; emits faq_* tracking events. Rendered with
 * textContent only (no innerHTML) — content is authored but shown to visitors.
 */
export function createFaqWidget(queue: EventQueue, faqUrl: string, onEscalate?: () => void) {
  let open = false;

  const ctx = () => ({
    path: location.pathname + location.search,
    url: location.href,
    referrer: document.referrer || undefined,
  });
  const emit = (type: string, props: Record<string, unknown>) =>
    queue.enqueue({ type: type as never, ts: Date.now(), ...ctx(), props });

  async function fetchArticles(q: string): Promise<FaqArticle[]> {
    try {
      const res = await fetch(`${faqUrl}&q=${encodeURIComponent(q)}`, {
        credentials: "omit",
        mode: "cors",
      });
      const data = (await res.json()) as { articles?: FaqArticle[] };
      return Array.isArray(data.articles) ? data.articles : [];
    } catch {
      return [];
    }
  }

  function open_(): void {
    if (open) return;
    open = true;
    const L = lang();
    const dir = L === "ar" ? "rtl" : "ltr";

    const overlay = document.createElement("div");
    overlay.setAttribute("dir", dir);
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px;font-family:system-ui,sans-serif;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:#fff;color:#111827;inline-size:100%;max-inline-size:420px;max-block-size:80vh;overflow:auto;border-radius:14px;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.25);";

    const input = document.createElement("input");
    input.placeholder = L === "ar" ? "ابحث عن مساعدة…" : "Search for help…";
    input.style.cssText =
      "inline-size:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit;margin-block-end:12px;";

    const results = document.createElement("div");

    const close = document.createElement("button");
    close.textContent = "✕";
    close.setAttribute("aria-label", "close");
    close.style.cssText =
      "position:absolute;inset-block-start:14px;inset-inline-end:18px;background:none;border:0;font-size:18px;cursor:pointer;color:#111827;";
    panel.style.position = "relative";

    const cleanup = () => {
      overlay.remove();
      open = false;
    };
    close.addEventListener("click", cleanup);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup();
    });

    function renderArticle(a: FaqArticle): void {
      emit("faq_view", { article_id: a.id });
      const c = a[L].title ? a[L] : a.ar.title ? a.ar : a.en;
      results.replaceChildren();
      const title = document.createElement("div");
      title.textContent = c.title;
      title.style.cssText = "font-weight:700;font-size:16px;margin-block-end:8px;";
      const body = document.createElement("div");
      body.textContent = c.body; // textContent → safe
      body.style.cssText = "font-size:14px;white-space:pre-wrap;line-height:1.6;";
      const helpful = document.createElement("div");
      helpful.style.cssText = "margin-block-start:16px;display:flex;gap:8px;align-items:center;";
      const q = document.createElement("span");
      q.textContent = L === "ar" ? "هل كان هذا مفيداً؟" : "Was this helpful?";
      q.style.cssText = "font-size:13px;opacity:.7;";
      const yes = document.createElement("button");
      yes.textContent = L === "ar" ? "نعم" : "Yes";
      const no = document.createElement("button");
      no.textContent = L === "ar" ? "لا" : "No";
      for (const b of [yes, no])
        b.style.cssText =
          "border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:4px 12px;cursor:pointer;font:inherit;font-size:13px;";
      yes.addEventListener("click", () => {
        emit("faq_vote_up", { article_id: a.id });
        yes.textContent = "✓";
      });
      no.addEventListener("click", () => {
        emit("faq_vote_down", { article_id: a.id });
        no.textContent = "✓";
      });
      helpful.append(q, yes, no);
      results.append(title, body, helpful);
    }

    function renderList(articles: FaqArticle[], q: string): void {
      results.replaceChildren();
      if (articles.length === 0) {
        if (q) emit("faq_search_noresult", { query: q });
        const none = document.createElement("div");
        none.textContent = L === "ar" ? "لا توجد نتائج" : "No results";
        none.style.cssText = "font-size:14px;opacity:.6;padding:8px 0;";
        results.append(none);
        // Audit M2: no answer → offer the Agent (escalation path).
        if (onEscalate) {
          const talk = document.createElement("button");
          talk.textContent = L === "ar" ? "تحدّث إلى ممثّل" : "Talk to a person";
          talk.style.cssText =
            "margin-block-start:8px;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit;font-size:13px;";
          talk.addEventListener("click", () => {
            cleanup();
            onEscalate();
          });
          results.append(talk);
        }
        return;
      }
      for (const a of articles) {
        const item = document.createElement("button");
        item.textContent = a[L].title || a.ar.title || a.en.title;
        item.style.cssText =
          "display:block;inline-size:100%;text-align:start;border:0;background:none;border-block-end:1px solid #f1f1f4;padding:10px 4px;cursor:pointer;font:inherit;font-size:14px;color:#111827;";
        item.addEventListener("click", () => renderArticle(a));
        results.append(item);
      }
    }

    let debounce: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener("input", () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = input.value.trim();
        if (q) emit("faq_search", { query: q });
        renderList(await fetchArticles(q), q);
      }, 300);
    });

    panel.append(close, input, results);
    overlay.append(panel);
    document.body.append(overlay);
    input.focus();
    // Initial list (no query).
    void fetchArticles("").then((a) => renderList(a, ""));
  }

  return { open: open_ };
}
