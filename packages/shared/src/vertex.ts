import { containsPii, maskPii } from "./pii";

/**
 * Vertex dogfooding tenant — a first-class, named-event schema.
 *
 * These 23 events ride the generic `track` event (`props.name` = a VERTEX_EVENT)
 * so multi-tenant Tracki's core `EVENT_TYPES` enum stays tenant-neutral. The
 * registry gives us three things from one source of truth, shared by the browser
 * client (types) and the ingestion edge (runtime enforcement):
 *   1. a typed event-name allowlist (no "generic click capture alone"),
 *   2. a privacy-safe property allowlist (everything else is dropped at the edge),
 *   3. one sanitizer that masks PII and bounds values before storage.
 *
 * PRIVACY CONTRACT: raw email/phone/name, OAuth tokens, order/customer/payment
 * data, session secrets, and sensitive query strings must NEVER reach Tracki.
 * The client only ever sends allowlisted scalar props; this sanitizer is the
 * defense-in-depth backstop that enforces it regardless of what the client sends.
 */

export const VERTEX_EVENTS = [
  // acquisition + engagement (anonymous)
  "landing_viewed",
  "language_changed",
  "hero_cta_clicked",
  "pricing_viewed",
  "pricing_plan_selected",
  "feature_section_viewed",
  "faq_opened",
  "demo_store_opened",
  "profit_analysis_clicked",
  // conversion intent
  "booking_started",
  "booking_completed",
  "trial_started",
  "signup_completed",
  // platform choice + connection
  "platform_selected",
  "zid_selected",
  "salla_selected",
  "oauth_started",
  "oauth_failed",
  "store_connected",
  // activation + revenue
  "first_sync_completed",
  "first_profit_report_viewed",
  "subscription_started",
  "subscription_cancelled",
] as const;
export type VertexEvent = (typeof VERTEX_EVENTS)[number];

const VERTEX_EVENT_SET = new Set<string>(VERTEX_EVENTS);
export function isVertexEvent(name: unknown): name is VertexEvent {
  return typeof name === "string" && VERTEX_EVENT_SET.has(name);
}

/**
 * First-party conversion events — the ONLY points at which Vertex may merge an
 * authenticated internal ID onto the anonymous visitor (see identity contract in
 * docs). Email is never a primary identifier.
 */
export const VERTEX_CONVERSION_EVENTS = [
  "booking_completed",
  "signup_completed",
  "trial_started",
  "store_connected",
] as const;

export const PLATFORM_INTEREST = ["zid", "salla", "both", "unknown"] as const;
export type PlatformInterest = (typeof PLATFORM_INTEREST)[number];

export const DEVICE_CLASSES = ["mobile", "tablet", "desktop", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const REFERRER_CATEGORIES = [
  "search",
  "social",
  "ads",
  "referral",
  "direct",
  "internal",
  "unknown",
] as const;
export type ReferrerCategory = (typeof REFERRER_CATEGORIES)[number];

/**
 * The complete privacy-safe property allowlist. Any prop key NOT in this set is
 * dropped at ingestion. Surrogate IDs only — never raw contact info.
 */
export const VERTEX_PROP_KEYS = [
  // identity / session (surrogate IDs only)
  "anonId",
  "sessionId",
  // page context
  "path",
  "language",
  "referrerCategory",
  "referrerHost",
  // acquisition (consent-gated on the client)
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "clickId",
  // coarse audience
  "deviceClass",
  "country",
  "region",
  "platformInterest",
  // event-specific safe descriptors (codes/enums, never free-form user text)
  "section",
  "planId",
  "plan",
  "currency",
  "faqId",
  "ctaId",
  "errorCode",
  "platform",
  "step",
  "reason",
  // first-party internal IDs — populated by the client only post-conversion
  "leadId",
  "userId",
  "orgId",
  "storeId",
] as const;
export type VertexPropKey = (typeof VERTEX_PROP_KEYS)[number];
const VERTEX_PROP_SET = new Set<string>(VERTEX_PROP_KEYS);

const MAX_VAL = 256;

/** Keep only PII-masked, length-bounded scalars; drop objects/arrays/null. */
function safeScalar(v: unknown): string | number | boolean | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const masked = maskPii(v.slice(0, MAX_VAL));
    // If a value still looks like PII after masking, drop it rather than store it.
    return containsPii(masked) ? undefined : masked;
  }
  return undefined;
}

export interface VertexSanitizeResult {
  /** false ⇒ not a recognized Vertex event; caller should leave props untouched. */
  ok: boolean;
  name: VertexEvent | null;
  /** Allowlisted, PII-masked props (includes `name`). */
  props: Record<string, string | number | boolean>;
  /** Keys removed because they are not on the allowlist (for QA/observability). */
  dropped: string[];
}

/**
 * Enforce the Vertex named-event schema on a `track` event's props at the
 * ingestion edge. Recognized events keep only allowlisted, PII-masked scalar
 * props; unrecognized names return ok=false so non-Vertex `track` events pass
 * through the generic pipeline unchanged.
 */
export function sanitizeVertexTrack(
  props: Record<string, unknown> | undefined,
): VertexSanitizeResult {
  const name = props?.name;
  if (!isVertexEvent(name)) return { ok: false, name: null, props: {}, dropped: [] };

  const out: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === "name") continue;
    if (!VERTEX_PROP_SET.has(k)) {
      dropped.push(k);
      continue;
    }
    const s = safeScalar(v);
    if (s !== undefined) out[k] = s;
    else dropped.push(k);
  }

  // Coerce categorical props to their closed sets.
  if ("platformInterest" in out && !PLATFORM_INTEREST.includes(out.platformInterest as PlatformInterest)) {
    out.platformInterest = "unknown";
  }
  if ("deviceClass" in out && !DEVICE_CLASSES.includes(out.deviceClass as DeviceClass)) {
    out.deviceClass = "unknown";
  }
  if (
    "referrerCategory" in out &&
    !REFERRER_CATEGORIES.includes(out.referrerCategory as ReferrerCategory)
  ) {
    out.referrerCategory = "unknown";
  }

  out.name = name;
  return { ok: true, name, props: out, dropped };
}

/**
 * Pure referrer classifier — reused by the browser client and covered by tests
 * so the client and any server-side derivation can't drift. Takes the referrer
 * HOST only (never the full URL) plus whether a paid click id was present.
 */
export function classifyReferrer(referrerHost: string | undefined, hasClickId: boolean): ReferrerCategory {
  if (hasClickId) return "ads";
  const h = (referrerHost ?? "").toLowerCase();
  if (!h) return "direct";
  if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex)\./.test(h)) return "search";
  if (/(^|\.)(facebook|instagram|twitter|x|t|linkedin|tiktok|snapchat|youtube|reddit|whatsapp)\./.test(h))
    return "social";
  if (/(^|\.)(tryvertex\.io)$/.test(h)) return "internal";
  return "referral";
}
