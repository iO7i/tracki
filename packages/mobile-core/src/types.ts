/**
 * @tracki/mobile-core — the headless protocol engine every Tracki mobile SDK
 * wraps (React Native directly; Flutter/iOS/Android re-implement the same wire
 * protocol — see docs/mobile-wire-protocol.md). Zero UI, zero platform APIs:
 * storage / transport / clock are injected, rendering is delegated to a
 * platform renderer through typed intents.
 *
 * Runtime deps are kept to zero-dep @tracki/shared subpaths only (type-only
 * imports are erased at build) so apps don't inherit zod.
 */

// ── Wire mirrors (type-compatible with @tracki/shared, locally declared so the
//    runtime stays dependency-free, like the snippet's types.ts) ─────────────

export type MobilePlatform = "ios" | "android";

export interface DeviceInfo {
  platform: MobilePlatform;
  osVersion?: string;
  appVersion?: string;
  model?: string;
  sdk?: "react-native" | "flutter" | "ios" | "android";
}

export interface EventInput {
  type: string;
  ts: number;
  path?: string;
  url?: string;
  referrer?: string;
  props?: Record<string, unknown>;
}

export interface Batch {
  key: string;
  anonId: string;
  userId?: string;
  sessionId: string;
  sentAt: number;
  device: DeviceInfo;
  events: EventInput[];
}

// ── Injected platform adapters ───────────────────────────────────────────────

/** Async key-value persistence (AsyncStorage / SharedPreferences / UserDefaults). */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** HTTP transport; default implementation uses global fetch. */
export interface Transport {
  post(url: string, body: unknown): Promise<unknown>;
  get(url: string): Promise<unknown>;
}

/** Injectable clock for deterministic tests. */
export type Clock = () => number;

// ── Render intents (SDK → app UI) ────────────────────────────────────────────

export interface LocalizedContent {
  title: string;
  body: string;
  cta?: CtaContent;
}

export interface CtaContent {
  label: string;
  kind?: string; // url | faq | chat | whatsapp (legacy: absent)
  url?: string;
  faq?: boolean; // legacy pre-slice-12 shape
}

export interface TourStepContent {
  title: string;
  body: string;
  anchor?: string;
}

/** A campaign action ready to render (modal/banner/tooltip/tour/drawer). */
export interface ActionIntent {
  intent: "action";
  actionId: string;
  /** popup ⇒ in-app modal; banner; tooltip; tour (steps); drawer (help sheet). */
  type: "popup" | "banner" | "tooltip" | "tour" | "drawer";
  variant: "A" | "B";
  /** Content resolved for the configured locale. */
  content: LocalizedContent;
  /** Guided-tour steps (type "tour"), locale-resolved. */
  steps?: TourStepContent[];
  /** Anchor key for tooltips (the app maps it to a view). */
  anchor?: string;
  /** Report a tap on the CTA; routes the channel (url/faq/chat/whatsapp). */
  activateCta(): void;
  /** Report the user dismissing the action. */
  dismiss(): void;
}

/** Server-driven Live Assist for a detected struggle (slice 5 mechanism). */
export interface AssistIntent {
  intent: "assist";
  actionId: string;
  mode: "answer" | "fallback";
  /** Resolved title/body — the matched FAQ in answer mode, else authored copy. */
  title: string;
  body: string;
  /** Escalation CTA from the action's authored content, if any. */
  ctaLabel?: string;
  /** Answer mode: report "was this helpful?". */
  helpful(): void;
  unhelpful(): void;
  /** Tap the escalate CTA (routes the channel). */
  escalate(): void;
}

/** FAQ launch (cta kind "faq"): pre-fetched published articles. */
export interface FaqIntent {
  intent: "faq";
  articles: Array<{ id: string; title: string; body: string }>;
  /** Re-query the help center. */
  search(query: string): Promise<Array<{ id: string; title: string; body: string }>>;
}

/** AI chat launch (cta kind "chat"): a live grounded-Agent conversation. */
export interface ChatIntent {
  intent: "chat";
  send(message: string): Promise<{ reply: string; escalate: boolean }>;
}

export type RenderIntent = ActionIntent | AssistIntent | FaqIntent | ChatIntent;

/** The platform SDK's renderer — receives intents, draws native UI. */
export interface Renderer {
  show(intent: RenderIntent): void;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface TrackiConfig {
  /** Project public key (pk_…). */
  key: string;
  /** Ingest origin, e.g. https://ingest.tracki.app */
  endpoint: string;
  device: DeviceInfo;
  storage: KeyValueStorage;
  /** UI locale for resolved content; Arabic-first default. */
  locale?: "ar" | "en";
  renderer?: Renderer;
  /** Open an external URL (wa.me deep link, cta url). Required for those CTAs. */
  openUrl?: (url: string) => void;
  transport?: Transport;
  clock?: Clock;
  /** Test seam: ids default to crypto.randomUUID-based. */
  idFactory?: (prefix: string) => string;
}
