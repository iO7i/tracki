import { RAGE_MIN_CLICKS, RAGE_WINDOW_MS, elementSignature } from "@tracki/shared/rage";
import { type ChannelHandlers, type CtaLike, ctaKind } from "./cta";
import type { EventQueue } from "./queue";
import { getAnonId } from "./storage";

// Snippet-local mirror of the manifest entry (zero deps).
interface Localized {
  title: string;
  body: string;
  cta?: CtaLike;
}
interface ManifestAction {
  id: string;
  type: "popup" | "banner" | "tooltip";
  content: { ar: Localized; en: Localized };
  contentB?: { ar: Localized; en: Localized };
  trigger: { kind: string; seconds?: number; eventName?: string };
  urlContains?: string;
  frequencyCap?: number;
  goalEvent?: string;
  anchorSelector?: string;
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

/** Stable 50/50 split per visitor (mirrors shared pickVariant). */
function pickVariant(anonId: string, actionId: string, hasB: boolean): "A" | "B" {
  if (!hasB) return "A";
  let h = 0;
  const s = `${anonId}:${actionId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? "A" : "B";
}

function lang(): "ar" | "en" {
  const l = (document.documentElement.lang || "").toLowerCase();
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("en")) return "en";
  return document.documentElement.dir === "rtl" ? "ar" : "en";
}

export interface ActionsRuntime {
  onTrack(name: string): void;
}

export function installActions(
  queue: EventQueue,
  manifestUrl: string,
  handlers: ChannelHandlers = {},
): ActionsRuntime {
  const actions: ManifestAction[] = [];
  const shownThisPage = new Set<string>();
  const shownThisSession = new Set<string>();
  const dir = () => (lang() === "ar" ? "rtl" : "ltr");

  const ctx = () => ({
    path: location.pathname + location.search,
    url: location.href,
    referrer: document.referrer || undefined,
  });
  const emit = (type: string, actionId: string, variant: string, channel?: string) =>
    queue.enqueue({
      type: type as never,
      ts: Date.now(),
      ...ctx(),
      props: { action_id: actionId, variant, ...(channel ? { channel } : {}) },
    });

  function capReached(a: ManifestAction): boolean {
    if (!a.frequencyCap) return false;
    return Number(lsGet(`tracki_act_${a.id}`) ?? 0) >= a.frequencyCap;
  }
  function bumpCap(a: ManifestAction): void {
    lsSet(`tracki_act_${a.id}`, String(Number(lsGet(`tracki_act_${a.id}`) ?? 0) + 1));
  }

  function maybeShow(a: ManifestAction): void {
    if (shownThisPage.has(a.id)) return;
    if (a.urlContains && !location.href.includes(a.urlContains)) return;
    if (capReached(a)) return;
    const variant = pickVariant(getAnonId(), a.id, !!a.contentB);
    const pack = variant === "B" && a.contentB ? a.contentB : a.content;
    const content = pack[lang()];
    try {
      render(a, variant, content);
    } catch {
      // Audit M1: a failed render must NOT count as shown — don't mark, don't
      // bump the cap, don't arm the goal, don't emit a phantom impression.
      return;
    }
    shownThisPage.add(a.id);
    shownThisSession.add(a.id);
    bumpCap(a);
    emit("action_impression", a.id, variant);
  }

  function render(a: ManifestAction, variant: string, c: Localized): void {
    const root = document.createElement("div");
    root.setAttribute("dir", dir());
    root.style.cssText =
      "position:fixed;z-index:2147483646;font-family:system-ui,sans-serif;box-sizing:border-box;";
    if (a.type === "banner") {
      root.style.cssText +=
        "inset-block-start:0;inset-inline:0;background:#2563eb;color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;";
    } else if (a.type === "tooltip") {
      // Audit N3: a malformed selector must not throw and drop the action.
      let anchor: Element | null = null;
      if (a.anchorSelector) {
        try {
          anchor = document.querySelector(a.anchorSelector);
        } catch {
          anchor = null;
        }
      }
      const r = anchor?.getBoundingClientRect();
      root.style.cssText +=
        "max-inline-size:280px;background:#111827;color:#fff;padding:10px 12px;border-radius:8px;font-size:13px;";
      // Audit N2: the rect is physical, so use physical top/left (correct in
      // both LTR and RTL); logical inset-inline-start would flip on RTL.
      root.style.top = `${(r?.bottom ?? 40) + 8}px`;
      root.style.left = `${r?.left ?? 16}px`;
    } else {
      // popup: centered card over a dim overlay.
      root.style.cssText +=
        "inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;";
    }

    const card = document.createElement("div");
    if (a.type === "popup") {
      card.style.cssText =
        "background:#fff;color:#111827;max-inline-size:360px;inline-size:100%;border-radius:14px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.2);";
    }
    const title = document.createElement("div");
    title.textContent = c.title; // textContent → no HTML injection (XSS guard)
    title.style.cssText = "font-weight:700;font-size:16px;margin-block-end:6px;";
    const body = document.createElement("div");
    body.textContent = c.body;
    body.style.cssText = "font-size:14px;opacity:.85;";
    card.appendChild(title);
    card.appendChild(body);

    const cleanup = () => root.remove();

    const cta = c.cta;
    const btnStyle =
      "display:inline-block;margin-block-start:14px;background:#2563eb;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:14px;cursor:pointer;border:0;font:inherit;";
    const kind = cta ? ctaKind(cta) : "url";
    if (cta?.label && kind === "url" && cta.url && /^https?:\/\//i.test(cta.url)) {
      const btn = document.createElement("a");
      btn.textContent = cta.label;
      btn.href = cta.url; // validated http(s)
      btn.rel = "noopener";
      btn.style.cssText = btnStyle;
      btn.addEventListener("click", () => {
        emit("action_click", a.id, variant, "url");
        cleanup();
      });
      card.appendChild(btn);
    } else if (cta?.label && kind !== "url") {
      // Slice 12 — right channeling: the CTA opens a channel widget (FAQ /
      // Agent chat / WhatsApp handoff) instead of navigating.
      const open =
        kind === "faq"
          ? handlers.openFaq
          : kind === "chat"
            ? handlers.openChat
            : handlers.openWhatsApp;
      if (open) {
        const btn = document.createElement("button");
        btn.textContent = cta.label;
        btn.style.cssText = btnStyle;
        btn.addEventListener("click", () => {
          emit("action_click", a.id, variant, kind);
          cleanup();
          open();
        });
        card.appendChild(btn);
      }
    }

    const close = document.createElement("button");
    close.textContent = "✕";
    close.setAttribute("aria-label", "close");
    close.style.cssText =
      "position:absolute;inset-block-start:8px;inset-inline-end:10px;background:none;border:0;color:inherit;font-size:16px;cursor:pointer;";
    if (a.type !== "popup") card.style.position = "relative";
    card.style.position = "relative";
    card.appendChild(close);
    close.addEventListener("click", () => {
      emit("action_dismiss", a.id, variant);
      cleanup();
    });

    if (a.type === "popup") {
      root.appendChild(card);
      // Dismiss on overlay click.
      root.addEventListener("click", (e) => {
        if (e.target === root) {
          emit("action_dismiss", a.id, variant);
          cleanup();
        }
      });
    } else {
      root.appendChild(card);
    }
    document.body.appendChild(root);
  }

  // Evaluate pageview-triggered actions for the current URL.
  function evaluatePageview(): void {
    for (const a of actions) if (a.trigger.kind === "pageview") maybeShow(a);
  }

  // --- trigger wiring ---
  function wire(): void {
    evaluatePageview();
    for (const a of actions) {
      if (a.trigger.kind === "time_on_page") {
        setTimeout(() => maybeShow(a), (a.trigger.seconds ?? 5) * 1000);
      }
    }

    // Audit M2: re-evaluate pageview/urlContains actions on SPA navigation.
    let lastPath = location.pathname + location.search;
    const onRoute = () => {
      const next = location.pathname + location.search;
      if (next === lastPath) return;
      lastPath = next;
      shownThisPage.clear(); // new page → pageview actions may show again
      evaluatePageview();
    };
    const wrap = (orig: History["pushState"]) =>
      function (this: History, ...args: Parameters<History["pushState"]>) {
        orig.apply(this, args);
        onRoute();
      };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener("popstate", onRoute);
    // exit intent (shared listener).
    document.addEventListener("mouseout", (e) => {
      if ((e as MouseEvent).clientY <= 0) {
        for (const a of actions) if (a.trigger.kind === "exit_intent") maybeShow(a);
      }
    });
    // local rage detection for instant intervention.
    let clicks: number[] = [];
    let lastSig = "";
    document.addEventListener(
      "click",
      (e) => {
        const el =
          (e.target as Element | null)?.closest("a,button,[role=button]") ??
          (e.target as Element | null);
        const sig = el
          ? elementSignature({ tag: el.tagName, id: el.id, class: el.getAttribute("class") })
          : "";
        const now = Date.now();
        if (sig !== lastSig) {
          clicks = [];
          lastSig = sig;
        }
        clicks.push(now);
        clicks = clicks.filter((t) => now - t < RAGE_WINDOW_MS);
        if (clicks.length >= RAGE_MIN_CLICKS) {
          clicks = [];
          for (const a of actions) if (a.trigger.kind === "rage_click") maybeShow(a);
        }
      },
      true,
    );
  }

  // Fetch the manifest, then wire triggers.
  fetch(manifestUrl, { credentials: "omit", mode: "cors" })
    .then((r) => r.json())
    .then((data: { actions?: ManifestAction[] }) => {
      if (Array.isArray(data.actions)) actions.push(...data.actions);
      wire();
    })
    .catch(() => {
      /* fail-silent */
    });

  return {
    onTrack(name: string) {
      for (const a of actions) {
        if (a.trigger.kind === "event" && a.trigger.eventName === name) maybeShow(a);
        if (a.goalEvent === name && shownThisSession.has(a.id)) {
          const variant = pickVariant(getAnonId(), a.id, !!a.contentB);
          emit("action_goal", a.id, variant);
        }
      }
    },
  };
}
