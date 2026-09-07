import { createActionEngine } from "./actions";
import { createAssistHandler } from "./assist";
import { createCtaRouter } from "./cta";
import { Identity, defaultIdFactory } from "./identity";
import { EventQueue } from "./queue";
import { fetchTransport } from "./transport";
import type { TrackiConfig } from "./types";

/** "Checkout Screen" → "/checkout-screen"-style path key (case preserved). */
export function screenPath(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, "-");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export type TrackiClient = Awaited<ReturnType<typeof createTracki>>;

/**
 * The Tracki mobile client. Hydrates identity from storage, then exposes a
 * fully synchronous tracking API (flushes are async + fail-silent). Emits the
 * cold app_foreground itself — one fewer thing for the host app to remember,
 * and the signal app_restart_loop detection needs.
 */
export async function createTracki(config: TrackiConfig) {
  const now = config.clock ?? (() => Date.now());
  const transport = config.transport ?? fetchTransport();
  const newId = config.idFactory ?? defaultIdFactory;
  const locale = () => config.locale ?? "ar";

  const identity = new Identity(config.storage, now, newId);
  await identity.hydrate();

  let currentPath = "/";
  let previousPath = "";
  let screenEnteredAt = now();

  const queue = new EventQueue(
    config.key,
    `${config.endpoint}/v1/events`,
    identity,
    config.device,
    transport,
    now,
  );

  const ctaDeps = {
    key: config.key,
    endpoint: config.endpoint,
    locale,
    platform: () => config.device.platform,
    currentPath: () => currentPath,
    queue,
    transport,
    renderer: config.renderer,
    openUrl: config.openUrl,
    identity,
    now,
  };
  const cta = createCtaRouter(ctaDeps);

  const assist = createAssistHandler({
    locale,
    currentPath: () => currentPath,
    queue,
    renderer: config.renderer,
    cta,
    now,
  });
  queue.setResponseHandler(assist.onResponse);

  const engine = createActionEngine({
    key: config.key,
    endpoint: config.endpoint,
    locale,
    currentPath: () => currentPath,
    anonId: () => identity.getAnonId(),
    queue,
    transport,
    storage: config.storage,
    renderer: config.renderer,
    cta,
    now,
  });
  const ready = engine.start();

  const emit = (type: string, props?: Record<string, unknown>): void => {
    queue.enqueue({
      type,
      ts: now(),
      path: currentPath,
      referrer: previousPath || undefined,
      props,
    });
  };

  // The launch itself: a cold start (drives app_restart_loop detection).
  emit("app_foreground", { launch: "cold" });

  return {
    /** Screen tracking: emits screen_leave (with duration) + screen_view. */
    screen(name: string, props?: Record<string, unknown>): void {
      const next = screenPath(name);
      if (currentPath !== "/") {
        emit("screen_leave", { durationMs: Math.max(0, now() - screenEnteredAt) });
      }
      previousPath = currentPath === "/" ? "" : currentPath;
      currentPath = next;
      screenEnteredAt = now();
      emit("screen_view", props);
      engine.onScreen();
    },

    /** App lifecycle. The SDK already emitted the initial cold foreground. */
    appForeground(launch: "cold" | "warm" = "warm"): void {
      emit("app_foreground", { launch });
    },
    appBackground(): void {
      emit("app_background", { durationMs: Math.max(0, now() - screenEnteredAt) });
      engine.onBackground();
      void queue.flush();
    },
    appTerminate(): void {
      emit("app_terminate");
      void queue.flush();
    },

    /** Navigation + entry points. */
    backNav(): void {
      emit("back_nav");
    },
    deepLink(url: string, ok = true): void {
      emit("deep_link", { url, ok });
    },
    pushOpen(props?: Record<string, unknown>): void {
      emit("push_open", props);
    },

    /** Auth + payment funnels. */
    otp(phase: "start" | "fail" | "success", props?: Record<string, unknown>): void {
      emit(`otp_${phase}`, props);
    },
    biometric(phase: "start" | "fail" | "success", props?: Record<string, unknown>): void {
      emit(`biometric_${phase}`, props);
    },
    payment(phase: "start" | "fail" | "complete", props?: Record<string, unknown>): void {
      emit(`payment_${phase}`, props);
    },

    /** Named flows: checkout | registration | loan | kyc | onboarding | custom. */
    flow(
      phase: "start" | "complete" | "abandon",
      flow: string,
      props?: Record<string, unknown>,
    ): void {
      emit(`flow_${phase}`, { ...props, flow });
    },

    permissionDenied(permission: string): void {
      emit("permission_denied", { permission });
    },
    error(message: string): void {
      emit("error", { message });
    },

    /** Custom events — also evaluates action `event` triggers + goals. */
    track(name: string, props?: Record<string, unknown>): void {
      emit("track", { ...props, name });
      engine.onTrack(name);
    },

    /** Identify the signed-in user (bridges anonymous → known). */
    identify(userId: string): void {
      identity.setUserId(userId);
      emit("identify");
    },

    /** Channel launchers (FAQ / Agent chat / WhatsApp) — usable directly. */
    openFaq: cta.openFaq,
    openChat: cta.openChat,
    openWhatsApp: cta.openWhatsApp,

    /** Force a network flush (returns when the batch settled). */
    flush(): Promise<void> {
      return queue.flush();
    },

    /** Resolves when the action manifest finished loading (tests/bench). */
    ready,

    /** Introspection (tests/bench). */
    anonId: () => identity.getAnonId(),
    sessionId: () => identity.currentSession(),
    path: () => currentPath,
  };
}
