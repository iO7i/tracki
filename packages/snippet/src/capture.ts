import type { EventQueue } from "./queue";
import type { EventInput, EventType } from "./types";

const TEXT_CAP = 50;

function ctx(): Pick<EventInput, "path" | "url" | "referrer"> {
  return {
    path: location.pathname + location.search,
    url: location.href,
    referrer: document.referrer || undefined,
  };
}

function emit(queue: EventQueue, type: EventType, props?: Record<string, unknown>): void {
  queue.enqueue({ type, ts: Date.now(), ...ctx(), props });
}

/** Compact, value-free descriptor of an element (never captures input values). */
function describe(el: Element): Record<string, unknown> {
  const tag = el.tagName.toLowerCase();
  const out: Record<string, unknown> = { tag };
  if (el.id) out.id = el.id;
  const cls = (el.getAttribute("class") || "").trim();
  if (cls) out.class = cls.slice(0, 120);
  // Text only for non-input elements; capped.
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (text) out.text = text.slice(0, TEXT_CAP);
  }
  return out;
}

function isSensitive(el: Element): boolean {
  const type = (el.getAttribute("type") || "").toLowerCase();
  return type === "password" || el.getAttribute("autocomplete") === "current-password";
}

/**
 * Wire up auto-capture. Returns a teardown fn (used by tests). Pageviews on SPA
 * navigation are caught by patching History + popstate.
 */
export function installCapture(queue: EventQueue): () => void {
  const teardowns: Array<() => void> = [];
  const on = <K extends keyof DocumentEventMap>(
    target: Document | Window,
    ev: K | string,
    fn: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(ev, fn, opts);
    teardowns.push(() => target.removeEventListener(ev, fn, opts));
  };

  // form_abandon bookkeeping: the form whose field was last focused without a
  // subsequent submit. Flushed on navigation / page hide (Audit M3).
  let pendingForm: Element | null = null;
  const flushAbandon = () => {
    if (pendingForm) {
      emit(queue, "form_abandon", describe(pendingForm));
      pendingForm = null;
    }
  };

  // Initial pageview.
  emit(queue, "pageview");

  // SPA route changes via History API.
  let lastPath = location.pathname + location.search;
  const fireRoute = () => {
    const next = location.pathname + location.search;
    if (next !== lastPath) {
      lastPath = next;
      flushAbandon();
      emit(queue, "route_change");
      emit(queue, "pageview");
    }
  };
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
    origPush.apply(this, args);
    fireRoute();
  };
  history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
    origReplace.apply(this, args);
    fireRoute();
  };
  teardowns.push(() => {
    history.pushState = origPush;
    history.replaceState = origReplace;
  });
  on(window, "popstate", fireRoute);

  // Clicks (raw — struggle classification is slice 2).
  on(
    document,
    "click",
    (e) => {
      const target = (e as MouseEvent).target as Element | null;
      if (!target || isSensitive(target)) return;
      const el = (target.closest("a,button,[role=button],input,select") as Element) ?? target;
      if (isSensitive(el)) return;
      emit(queue, "click", describe(el));
    },
    { capture: true, passive: true },
  );

  // Form interactions (value-free).
  on(
    document,
    "focusin",
    (e) => {
      const el = (e as FocusEvent).target as Element | null;
      if (el && /^(input|textarea|select)$/i.test(el.tagName) && !isSensitive(el)) {
        pendingForm = (el as HTMLInputElement).form ?? el.closest("form") ?? el;
        emit(queue, "form_focus", describe(el));
      }
    },
    { capture: true },
  );
  on(
    document,
    "submit",
    (e) => {
      const form = (e as SubmitEvent).target as Element | null;
      // A submit completes the interaction — no abandonment.
      pendingForm = null;
      if (form) emit(queue, "form_submit", describe(form));
    },
    { capture: true },
  );

  // Errors.
  on(window, "error", (e) => {
    const ev = e as ErrorEvent;
    emit(queue, "error", { message: String(ev.message ?? "").slice(0, 200) });
  });
  on(window, "unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    emit(queue, "error", { message: String(reason ?? "rejection").slice(0, 200) });
  });

  // Page leave + final flush.
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      flushAbandon();
      emit(queue, "page_leave");
      queue.flush(true);
    }
  };
  on(document, "visibilitychange", onHide);
  on(window, "pagehide", () => {
    flushAbandon();
    emit(queue, "page_leave");
    queue.flush(true);
  });

  return () => {
    for (const t of teardowns) t();
  };
}
