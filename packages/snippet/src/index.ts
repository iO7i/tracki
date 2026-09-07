import { installActions } from "./actions";
import { createAssistRenderer } from "./assist";
import { installCapture } from "./capture";
import { createChatWidget } from "./chat";
import { createWhatsAppOpener } from "./cta";
import { createFaqWidget } from "./faq";
import { EventQueue } from "./queue";
import { getAnonId, getSessionId, setUserId } from "./storage";
import type { EventInput } from "./types";

type QueuedCall = unknown[];

interface TrackiStub {
  q?: QueuedCall[];
  loaded?: boolean;
}

interface TrackiApi {
  track(name: string, props?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  page(props?: Record<string, unknown>): void;
  consent(granted: boolean): void;
  faq(): void;
  chat(): void;
  loaded: boolean;
}

type ConsentState = "granted" | "denied" | "pending";

/**
 * Resolve the starting consent state. Default is opt-in ("pending" ⇒ hold, never
 * send until the host calls tracki.consent(true)). data-consent="granted" opts a
 * first-party/QA context in. A browser Do-Not-Track / GPC signal forces "denied"
 * unless the host has explicitly granted.
 */
function resolveConsent(script: HTMLScriptElement | null): ConsentState {
  const attr = script?.getAttribute("data-consent");
  if (attr === "granted") return "granted";
  if (attr === "denied") return "denied";
  const nav = navigator as { doNotTrack?: string; globalPrivacyControl?: boolean };
  const dnt =
    nav.doNotTrack === "1" ||
    (window as { doNotTrack?: string }).doNotTrack === "1" ||
    nav.globalPrivacyControl === true;
  return dnt ? "denied" : "pending";
}

function resolveConfig(): {
  key: string;
  endpoint: string;
  consent: ConsentState;
  chat: boolean;
} | null {
  const current =
    (document.currentScript as HTMLScriptElement | null) ??
    Array.from(document.getElementsByTagName("script")).find((s) =>
      /tracki(\.min)?\.js/.test(s.src),
    ) ??
    null;

  const key = current?.getAttribute("data-key") ?? "";
  if (!key) return null;
  const src = current?.src ?? "";
  const endpoint =
    current?.getAttribute("data-endpoint") ??
    (src ? `${new URL(src).origin}/v1/events` : "/v1/events");
  // Autonomous AI chat launcher is on by default; data-chat="off" feature-flags
  // it out (restrained-actions-only deployments enable interventions gradually).
  const chat = current?.getAttribute("data-chat") !== "off";
  return { key, endpoint, consent: resolveConsent(current), chat };
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const existing = (window as { tracki?: TrackiStub }).tracki;
  if (existing && (existing as TrackiStub).loaded) return;

  const config = resolveConfig();
  if (!config) return;

  const queue = new EventQueue(config.key, config.endpoint);
  // Gate BEFORE any producer runs so the first auto-captured pageview respects consent.
  queue.setInitialConsent(config.consent);
  installCapture(queue);

  // FAQ widget + action runtime: both live next to the events endpoint.
  const base = config.endpoint.replace(/\/v1\/events$/, "");
  const faqUrl = `${base}/v1/faq?key=${encodeURIComponent(config.key)}`;
  // implementation: the Tracki Agent chat widget (created first so the FAQ widget can
  // escalate to it when it has no answer — Audit M2).
  const chatWidget = createChatWidget(`${base}/v1/chat`, config.key, queue);
  const faqWidget = createFaqWidget(queue, faqUrl, () => chatWidget.open());
  const manifestUrl = `${base}/v1/actions?key=${encodeURIComponent(config.key)}`;
  // implementation — right channeling: CTAs route to FAQ / Agent chat / WhatsApp.
  const channels = {
    openFaq: () => faqWidget.open(),
    openChat: () => chatWidget.open(),
    openWhatsApp: createWhatsAppOpener(`${base}/v1/handoff`, config.key),
  };
  const actions = installActions(queue, manifestUrl, channels);

  // implementation: render server-driven Live Assist; escalation opens the Agent.
  const assist = createAssistRenderer(queue, channels);
  queue.setResponseHandler((data) => {
    const d = data as { assist?: Parameters<typeof assist.show>[0] };
    if (d?.assist) assist.show(d.assist);
  });

  const ctx = () => ({
    path: location.pathname + location.search,
    url: location.href,
    referrer: document.referrer || undefined,
  });
  const enqueue = (e: Omit<EventInput, "ts">) => queue.enqueue({ ts: Date.now(), ...e });

  const api: TrackiApi = {
    track(name, props) {
      enqueue({ type: "track", ...ctx(), props: { ...props, name } });
      actions.onTrack(name);
    },
    identify(userId, traits) {
      // Flush anonymous events BEFORE setting the user id so they keep their
      // pre-login attribution (Audit N3) — the batch envelope's userId is read
      // at flush time.
      queue.flush(false);
      setUserId(userId);
      enqueue({ type: "identify", ...ctx(), props: { ...traits, anonId: getAnonId() } });
    },
    page(props) {
      enqueue({ type: "pageview", ...ctx(), props });
    },
    consent(granted) {
      queue.setConsent(!!granted);
    },
    faq() {
      faqWidget.open();
    },
    chat() {
      chatWidget.open();
    },
    loaded: true,
  };

  // Replay any calls queued by the loader stub before this script loaded.
  const queued = existing?.q ?? [];
  (window as { tracki?: unknown }).tracki = api;
  for (const call of queued) {
    const [method, ...args] = call;
    const fn = (api as unknown as Record<string, (...a: unknown[]) => void>)[method as string];
    if (typeof fn === "function") {
      try {
        fn(...args);
      } catch {
        /* fail-silent */
      }
    }
  }

  // Touch session so the first batch has a fresh session id.
  getSessionId();

  // Mount the chat launcher bubble (visitors can open the Agent any time).
  // Feature-flagged: skipped when data-chat="off" (restrained deployments).
  if (config.chat) chatWidget.mountLauncher();
}

try {
  boot();
} catch {
  /* never break the host page */
}
