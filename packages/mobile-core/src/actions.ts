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

  const emit = (type: string, actionId: string, variant: string, channel?: string) =>
    deps.queue.enqueue({
      type,
      ts: deps.now(),
      path: deps.currentPath(),
      props: { action_id: actionId, variant, ...(channel ? { channel } : {}) },
    });

  async function loadCaps(): Promise<void> {
    try {
      caps = JSON.parse((await deps.storage.get(CAPS_KEY)) ?? "{}") as Record<string, number>;
    } catch {
      caps = {};
    }
    capsLoaded = true;
  }

  function bumpCap(a: ManifestAction): void {
    caps[a.id] = (caps[a.id] ?? 0) + 1;
    void deps.storage.set(CAPS_KEY, JSON.stringify(caps)).catch(() => {});
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
    if (!deps.renderer) return;
    if (shownThisScreen.has(a.id)) return;
    if (a.urlContains && !deps.currentPath().includes(a.urlContains)) return;
    if (a.frequencyCap && (caps[a.id] ?? 0) >= a.frequencyCap) return;
    const variant = pickVariant(deps.anonId(), a.id, !!a.contentB);
    const content = localized(a, variant);
    const intent: ActionIntent = {
      intent: "action",
      actionId: a.id,
      type: a.type,
      variant,
      content,
      steps: tourSteps(a),
      anchor: a.anchorSelector,
      activateCta: () => {
        if (!content.cta) return;
        const kind = deps.cta.activate(content.cta);
        emit("action_click", a.id, variant, kind);
      },
      dismiss: () => emit("action_dismiss", a.id, variant),
    };
    try {
      deps.renderer.show(intent);
    } catch {
      // Audit slice-3 M1 parity: a failed render is NOT an impression.
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

  /** Fetch the mobile-surface manifest, then arm time-based triggers. */
  async function start(): Promise<void> {
    await loadCaps();
    try {
      const data = (await deps.transport.get(
        `${deps.endpoint}/v1/actions?key=${encodeURIComponent(deps.key)}&surface=mobile`,
      )) as { actions?: ManifestAction[] } | undefined;
      if (Array.isArray(data?.actions)) actions.push(...data.actions);
    } catch {
      /* fail-silent */
    }
    evaluateScreen();
    for (const a of actions) {
      if (a.trigger.kind === "time_on_page") {
        const t = setTimeout(() => maybeShow(a), (a.trigger.seconds ?? 5) * 1000);
        (t as { unref?: () => void }).unref?.();
      }
    }
  }

  return {
    start,
    /** New screen — screen-scoped impressions reset, pageview triggers re-run. */
    onScreen(): void {
      shownThisScreen.clear();
      if (capsLoaded) evaluateScreen();
    },
    /** App went to background — the mobile analogue of exit intent. */
    onBackground(): void {
      for (const a of actions) if (a.trigger.kind === "exit_intent") maybeShow(a);
    },
    /** A custom event — event triggers + goal attribution. */
    onTrack(name: string): void {
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
