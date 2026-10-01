import { isMobileDiagnostic, safeNativeRoute } from "@tracki/shared/mobile-diagnostics";
import { createActionEngine } from "./actions";
import { createAssistHandler } from "./assist";
import { createCtaRouter } from "./cta";
import { Identity, defaultIdFactory, storageNamespace } from "./identity";
import { EventQueue } from "./queue";
import { fetchTransport } from "./transport";
import type { CapturePolicy, EventInput, TrackiConfig, Transport } from "./types";

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
  const namespace =
    config.storageNamespace ?? storageNamespace(config.key, config.endpoint, config.environment);
  let policy: CapturePolicy = {
    diagnostics: config.capturePolicy?.diagnostics === true,
    activity: config.capturePolicy?.activity === true,
  };
  let scopeTag = config.scopeTag;
  let foreground = config.initialAppState !== "background";
  let disposed = false;

  const identity = new Identity(config.storage, now, newId, namespace);
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
    {
      storage: config.storage,
      storageNamespace: namespace,
      scopeTag: () => scopeTag,
      build: config.build,
      allowed: (event) =>
        !disposed && (isMobileDiagnostic(event) ? policy.diagnostics : policy.activity),
    },
  );
  await queue.hydrate();

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
  queue.setResponseHandler((data) => {
    if (!disposed && foreground && policy.activity) assist.onResponse(data);
  });

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
    storageNamespace: namespace,
    enabled: () => policy.activity,
    isForeground: () => foreground,
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
  if (foreground) emit("app_foreground", { launch: "cold" });

  async function reset(): Promise<void> {
    policy = { diagnostics: false, activity: false };
    scopeTag = undefined;
    engine.pause();
    await queue.clear();
    await identity.reset();
    await engine.reset();
    currentPath = "/";
    previousPath = "";
    screenEnteredAt = now();
  }

  return {
    /** Screen tracking: emits screen_leave (with duration) + screen_view. */
    screen(name: string, props?: Record<string, unknown>): void {
      if (disposed) return;
      const next = safeNativeRoute(screenPath(name));
      if (currentPath !== "/") {
        emit("screen_leave", { durationMs: Math.max(0, now() - screenEnteredAt) });
      }
      previousPath = currentPath === "/" ? "" : currentPath;
      currentPath = next;
      screenEnteredAt = now();
      if (foreground) emit("screen_view", props);
      engine.onScreen();
    },

    /** App lifecycle. The SDK already emitted the initial cold foreground. */
    appForeground(launch: "cold" | "warm" = "warm"): void {
      if (disposed || foreground) return;
      foreground = true;
      screenEnteredAt = now();
      emit("app_foreground", { launch });
      engine.onForeground();
    },
    appBackground(): void {
      if (disposed || !foreground) return;
      foreground = false;
      emit("app_background", { durationMs: Math.max(0, now() - screenEnteredAt) });
      engine.onBackground();
      void queue.flush();
    },
    appTerminate(): void {
      emit("app_terminate");
      foreground = false;
      engine.onBackground();
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
    error(code: string): void {
      emit("error", { code });
    },
    /** Fixed diagnostics only, with route templates and validated W3C identifiers. */
    diagnostic(event: EventInput): void {
      if (!disposed && isMobileDiagnostic(event)) queue.enqueue(event);
    },

    /** Custom events — also evaluates action `event` triggers + goals. */
    track(name: string, props?: Record<string, unknown>): void {
      emit("track", { ...props, name });
      engine.onTrack(name);
    },

    /** Identify the signed-in user (bridges anonymous → known). */
    identify(userId: string): void {
      if (disposed || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) return;
      if (identity.getUserId() && identity.getUserId() !== userId) identity.rotateSession();
      identity.setUserId(userId);
      emit("identify");
    },

    /** Channel launchers (FAQ / Agent chat / WhatsApp) — usable directly. */
    openFaq(): void {
      if (!disposed && foreground) cta.openFaq();
    },
    openChat(): void {
      if (!disposed && foreground) cta.openChat();
    },
    openWhatsApp(): void {
      if (!disposed && foreground) cta.openWhatsApp();
    },

    /** Force a network flush (returns when the batch settled). */
    flush(): Promise<void> {
      return queue.flush();
    },
    queueHealth: () => queue.health(),

    /** Changing collection policy purges events which no longer have permission. */
    async setCapturePolicy(next: CapturePolicy): Promise<void> {
      if (disposed) return;
      const previousActivity = policy.activity;
      policy = { diagnostics: next.diagnostics === true, activity: next.activity === true };
      if (!policy.activity) engine.pause();
      await queue.applyPolicy();
      if (policy.activity) await engine.start();
      if (!previousActivity && policy.activity && foreground) {
        emit("app_foreground", { launch: "cold" });
        engine.onForeground();
      }
    },
    capturePolicy: (): CapturePolicy => ({ ...policy }),
    async setCaptureScope(next: string | null): Promise<void> {
      if (disposed || scopeTag === (next ?? undefined)) return;
      const previous = scopeTag;
      scopeTag = next ?? undefined;
      await queue.reconcileScope();
      if (previous !== undefined) identity.rotateSession();
    },
    captureScope: (): string | null => scopeTag ?? null,
    /** Authentication transport replaces event delivery only; no tokens enter assistance APIs. */
    setTransport(next: Transport): void {
      queue.setTransport(next);
    },
    reset,
    logout: reset,
    dispose(): void {
      disposed = true;
      engine.dispose();
      queue.dispose();
    },

    /** Resolves when the action manifest finished loading (tests/bench). */
    ready,

    /** Introspection (tests/bench). */
    anonId: () => identity.getAnonId(),
    sessionId: () => identity.currentSession(),
    path: () => currentPath,
  };
}
