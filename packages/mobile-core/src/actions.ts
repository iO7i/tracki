import type { CtaRouter } from "./cta";
import type { EventQueue } from "./queue";
import type {
  ActionIntent,
  Clock,
  KeyValueStorage,
  LocalizedContent,
  Renderer,
  TourStepContent,
  Transport,
} from "./types";

// Local mirror of the mobile manifest entry (zero deps, like the snippet's).
interface Localized {
  title: string;
  body: string;
  cta?: { label: string; kind?: string; url?: string; faq?: boolean };
}
interface ManifestAction {
  id: string;
  type: "popup" | "banner" | "tooltip" | "tour" | "drawer";
  content: { ar: Localized; en: Localized };
  contentB?: { ar: Localized; en: Localized };
  trigger: { kind: string; seconds?: number; eventName?: string };
  urlContains?: string;
  frequencyCap?: number;
  goalEvent?: string;
  anchorSelector?: string;
  steps?: Array<{
    ar: { title: string; body: string };
    en: { title: string; body: string };
    anchor?: string;
  }>;
}

const CAPS_KEY = "tracki_caps";

/** Stable 50/50 split per visitor (mirrors shared pickVariant). */
export function pickVariant(anonId: string, actionId: string, hasB: boolean): "A" | "B" {
  if (!hasB) return "A";
  let h = 0;
  const s = `${anonId}:${actionId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? "A" : "B";
}

interface EngineDeps {
  key: string;
  endpoint: string;
  locale: () => "ar" | "en";
  currentPath: () => string;
  anonId: () => string;
  queue: EventQueue;
  transport: Transport;
  storage: KeyValueStorage;
  renderer?: Renderer;
  cta: CtaRouter;
  now: Clock;
  storageNamespace?: string;
  enabled?: () => boolean;
  isForeground?: () => boolean;
}

/**
 * Mobile action engine — the snippet's actions runtime re-imagined for apps:
 * screen_view plays the role of pageview, app_background plays exit_intent,
 * `event` fires on track(); struggle actions stay server-driven (Live Assist).
 * Frequency caps persist across launches in one storage-backed JSON map.
 */
export function createActionEngine(deps: EngineDeps) {
  const actions: ManifestAction[] = [];
  const shownThisScreen = new Set<string>();
  const shownThisSession = new Set<string>();
  let caps: Record<string, number> = {};
  let capsLoaded = false;
  let started = false;
  let disposed = false;
  let generation = 0;
  let capsWrites: Promise<void> = Promise.resolve();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const capsKey = `${deps.storageNamespace ?? "tracki:v2:default"}:${CAPS_KEY}`;
  const allowed = () => !disposed && (deps.enabled?.() ?? true) && (deps.isForeground?.() ?? true);
  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };

  const emit = (type: string, actionId: string, variant: string, channel?: string) =>
    deps.queue.enqueue({
      type,
      ts: deps.now(),
      path: deps.currentPath(),
      props: { action_id: actionId, variant, ...(channel ? { channel } : {}) },
    });

  async function loadCaps(epoch: number): Promise<void> {
    let loaded: Record<string, number> = {};
    try {
      const value: unknown = JSON.parse((await deps.storage.get(capsKey)) ?? "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        loaded = Object.fromEntries(
          Object.entries(value).filter(
            ([key, count]) =>
              /^[A-Za-z0-9_-]{1,128}$/.test(key) &&
              typeof count === "number" &&
              Number.isSafeInteger(count) &&
              count >= 0,
          ),
        );
      }
    } catch {
      loaded = {};
    }
    if (disposed || epoch !== generation) return;
    caps = loaded;
    capsLoaded = true;
  }

  function bumpCap(a: ManifestAction): void {
    caps[a.id] = (caps[a.id] ?? 0) + 1;
    const snapshot = JSON.stringify(caps);
    capsWrites = capsWrites.then(() => deps.storage.set(capsKey, snapshot)).catch(() => {});
  }

  function localized(a: ManifestAction, variant: "A" | "B"): LocalizedContent {
    const pack = variant === "B" && a.contentB ? a.contentB : a.content;
    return pack[deps.locale()];
  }

  function tourSteps(a: ManifestAction): TourStepContent[] | undefined {
    if (a.type !== "tour" || !a.steps?.length) return undefined;
    const L = deps.locale();
    return a.steps.map((s) => ({ ...s[L], anchor: s.anchor }));
  }

  function maybeShow(a: ManifestAction): void {
    if (!allowed() || !deps.renderer) return;
    if (shownThisScreen.has(a.id)) return;
    if (a.urlContains && !deps.currentPath().includes(a.urlContains)) return;
    if (a.frequencyCap && (caps[a.id] ?? 0) >= a.frequencyCap) return;
    const variant = pickVariant(deps.anonId(), a.id, !!a.contentB);
    const content = localized(a, variant);
    const intentGeneration = generation;
    const intent: ActionIntent = {
      intent: "action",
      actionId: a.id,
      type: a.type,
      variant,
      content,
      steps: tourSteps(a),
      anchor: a.anchorSelector,
      activateCta: () => {
        if (!allowed() || intentGeneration !== generation || !content.cta) return;
        const kind = deps.cta.activate(content.cta);
        emit("action_click", a.id, variant, kind);
      },
      dismiss: () => {
        if (allowed() && intentGeneration === generation) emit("action_dismiss", a.id, variant);
      },
    };
    try {
      deps.renderer.show(intent);
    } catch {
      // Audit implementation M1 parity: a failed render is NOT an impression.
      return;
    }
    shownThisScreen.add(a.id);
    shownThisSession.add(a.id);
    bumpCap(a);
    emit("action_impression", a.id, variant);
  }

  function evaluateScreen(): void {
    for (const a of actions) if (a.trigger.kind === "pageview") maybeShow(a);
  }

  function armTimers(): void {
    clearTimers();
    if (!allowed()) return;
    for (const a of actions) {
      if (a.trigger.kind !== "time_on_page") continue;
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          maybeShow(a);
        },
        (a.trigger.seconds ?? 5) * 1000,
      );
      timers.add(timer);
      (timer as { unref?: () => void }).unref?.();
    }
  }

  /** Fetch the mobile-surface manifest, then arm time-based triggers. */
  async function start(): Promise<void> {
    if (disposed || started || !(deps.enabled?.() ?? true)) return;
    started = true;
    const pendingGeneration = generation;
    await loadCaps(pendingGeneration);
    if (disposed || generation !== pendingGeneration) return;
    try {
      const data = (await deps.transport.get(
        `${deps.endpoint}/v1/actions?key=${encodeURIComponent(deps.key)}&surface=mobile`,
      )) as { actions?: ManifestAction[] } | undefined;
      if (disposed || generation !== pendingGeneration) return;
      if (Array.isArray(data?.actions)) actions.push(...data.actions);
    } catch {
      /* fail-silent */
    }
    evaluateScreen();
    armTimers();
  }

  return {
    start,
    /** New screen — screen-scoped impressions reset, pageview triggers re-run. */
    onScreen(): void {
      shownThisScreen.clear();
      if (capsLoaded) evaluateScreen();
      armTimers();
    },
    /** App went to background — the mobile analogue of exit intent. */
    onBackground(): void {
      clearTimers();
    },
    onForeground(): void {
      if (capsLoaded) evaluateScreen();
      armTimers();
    },
    pause(): void {
      clearTimers();
    },
    async reset(): Promise<void> {
      generation++;
      clearTimers();
      actions.length = 0;
      started = false;
      capsLoaded = false;
      caps = {};
      shownThisScreen.clear();
      shownThisSession.clear();
      try {
        await capsWrites;
        if (deps.storage.remove) await deps.storage.remove(capsKey);
        else await deps.storage.set(capsKey, "{}");
      } catch {
        /* App remains usable if local persistence is unavailable. */
      }
    },
    dispose(): void {
      disposed = true;
      generation++;
      clearTimers();
    },
    /** A custom event — event triggers + goal attribution. */
    onTrack(name: string): void {
      if (!allowed()) return;
      for (const a of actions) {
        if (a.trigger.kind === "event" && a.trigger.eventName === name) maybeShow(a);
        if (a.goalEvent === name && shownThisSession.has(a.id)) {
          emit("action_goal", a.id, pickVariant(deps.anonId(), a.id, !!a.contentB));
        }
      }
    },
    /** Test seam. */
    get loadedCount(): number {
      return actions.length;
    },
  };
}

export type ActionEngine = ReturnType<typeof createActionEngine>;
