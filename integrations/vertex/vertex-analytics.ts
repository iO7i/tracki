/**
 * Vertex ⇄ Tracki analytics client — a framework-agnostic, dependency-free
 * drop-in for tryvertex.io.
 *
 * Responsibilities:
 *   - load the Tracki snippet (consent-gated, AI-chat feature-flagged OFF),
 *   - expose a TYPED method per Vertex event (no generic click capture),
 *   - attach only privacy-safe context to every event,
 *   - perform the anon→user identity merge ONLY on first-party conversions,
 *   - never transmit raw email/phone/name/token/order/payment data.
 *
 * The event names + property allowlist mirror `@tracki/shared` `vertex.ts`
 * (the ingestion edge re-enforces the allowlist, so this is a convenience layer,
 * not the security boundary). Keep the two lists in sync.
 *
 * Usage (plain):   VertexAnalytics.init({ key: 'pk_...', endpoint: 'https://ingest.tryvertex.io/v1/events' })
 *                  VertexAnalytics.consent(true)
 *                  VertexAnalytics.pricingPlanSelected('growth')
 */

export type PlatformInterest = "zid" | "salla" | "both" | "unknown";
type Platform = "zid" | "salla";

export interface VertexInitConfig {
  /** Tracki project public key (pk_...). */
  key: string;
  /** Full ingest events endpoint, e.g. https://ingest.tryvertex.io/v1/events */
  endpoint: string;
  /** Starting consent: "granted" (first-party/QA) or "pending" (default: opt-in). */
  consent?: "granted" | "pending" | "denied";
  /** Host used to classify same-site referrers. Defaults to the browser's
   *  location.hostname when omitted (never hardcode a production domain). */
  siteHost?: string;
}

type Props = Record<string, string | number | boolean | undefined>;

// ---- module state -----------------------------------------------------------
let cfg: VertexInitConfig | null = null;
let platformInterest: PlatformInterest = "unknown";
let siteHost = "tryvertex.io";

// ---- snippet bridge ---------------------------------------------------------
interface TrackiApi {
  track(name: string, props?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  consent(granted: boolean): void;
  page(props?: Record<string, unknown>): void;
}
function tracki(): TrackiApi {
  const w = window as unknown as { tracki?: TrackiApi & { q?: unknown[][] } };
  if (w.tracki) return w.tracki;
  // Loader stub: queue calls until the real snippet replaces window.tracki.
  const q: unknown[][] = [];
  const stub = new Proxy({} as TrackiApi & { q: unknown[][] }, {
    get(_t, prop) {
      if (prop === "q") return q;
      return (...args: unknown[]) => q.push([prop, ...args]);
    },
  });
  w.tracki = stub;
  return stub;
}

// ---- privacy-safe context ---------------------------------------------------
function deviceClass(): "mobile" | "tablet" | "desktop" | "unknown" {
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  if (ua) return "desktop";
  return "unknown";
}

/** Classify the referrer by HOST only (never the full URL / query string). */
function referrerCategory(): string {
  const ref = document.referrer;
  let host = "";
  try {
    host = ref ? new URL(ref).hostname.toLowerCase() : "";
  } catch {
    host = "";
  }
  const params = new URLSearchParams(location.search);
  const hasClickId = params.has("gclid") || params.has("fbclid") || params.has("msclkid");
  if (hasClickId) return "ads";
  if (!host) return "direct";
  if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex)\./.test(host)) return "search";
  if (/(^|\.)(facebook|instagram|twitter|x|linkedin|tiktok|snapchat|youtube|reddit|whatsapp)\./.test(host))
    return "social";
  if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`))) return "internal";
  return "referral";
}

/** UTM + click ids — captured ONLY once consent is granted. */
function acquisition(): Props {
  if (cfg?.consent === "denied") return {};
  const p = new URLSearchParams(location.search);
  const out: Props = {};
  const utm = (k: string, key: keyof Props) => {
    const v = p.get(k);
    if (v) out[key as string] = v.slice(0, 128);
  };
  utm("utm_source", "utmSource");
  utm("utm_medium", "utmMedium");
  utm("utm_campaign", "utmCampaign");
  utm("utm_term", "utmTerm");
  utm("utm_content", "utmContent");
  const clickId = p.get("gclid") || p.get("fbclid") || p.get("msclkid");
  if (clickId) out.clickId = clickId.slice(0, 128);
  return out;
}

function baseContext(): Props {
  return {
    language: document.documentElement.lang || undefined,
    deviceClass: deviceClass(),
    referrerCategory: referrerCategory(),
    platformInterest,
    ...acquisition(),
  };
}

// ---- send -------------------------------------------------------------------
function emit(name: string, props?: Props): void {
  const merged: Props = { ...baseContext(), ...(props ?? {}) };
  // Drop undefined so the wire payload stays lean.
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) clean[k] = v;
  tracki().track(name, clean);
}

// ---- public API -------------------------------------------------------------
export const VertexAnalytics = {
  init(config: VertexInitConfig): void {
    cfg = config;
    siteHost = config.siteHost ?? (typeof location !== "undefined" ? location.hostname : "");
    if (typeof document === "undefined") return;
    // Inject the Tracki snippet if not already present.
    const origin = new URL(config.endpoint).origin;
    if (!document.querySelector('script[data-tracki="1"]')) {
      const s = document.createElement("script");
      s.async = true;
      s.src = `${origin}/tracki.js`;
      s.setAttribute("data-tracki", "1");
      s.setAttribute("data-key", config.key);
      s.setAttribute("data-endpoint", config.endpoint);
      s.setAttribute("data-consent", config.consent ?? "pending");
      s.setAttribute("data-chat", "off"); // autonomous AI chat feature-flagged off
      document.head.appendChild(s);
    }
  },

  /** Update consent (drives the snippet's transmit gate). */
  consent(granted: boolean): void {
    if (cfg) cfg.consent = granted ? "granted" : "denied";
    tracki().consent(granted);
  },

  // acquisition + engagement (anonymous) --------------------------------------
  landingViewed(): void {
    emit("landing_viewed");
  },
  languageChanged(language: string): void {
    emit("language_changed", { language });
  },
  heroCtaClicked(ctaId?: string): void {
    emit("hero_cta_clicked", { ctaId });
  },
  pricingViewed(): void {
    emit("pricing_viewed");
  },
  pricingPlanSelected(planId: string): void {
    emit("pricing_plan_selected", { planId });
  },
  featureSectionViewed(section: string): void {
    emit("feature_section_viewed", { section });
  },
  faqOpened(faqId?: string): void {
    emit("faq_opened", { faqId });
  },
  demoStoreOpened(): void {
    emit("demo_store_opened");
  },
  profitAnalysisClicked(): void {
    emit("profit_analysis_clicked");
  },

  // conversion intent ---------------------------------------------------------
  bookingStarted(leadId?: string): void {
    emit("booking_started", { leadId });
  },
  /** First-party conversion: merges identity if a userId is supplied. */
  bookingCompleted(o: { leadId?: string; userId?: string } = {}): void {
    if (o.userId) tracki().identify(o.userId);
    emit("booking_completed", { leadId: o.leadId, userId: o.userId });
  },
  /** First-party conversion. */
  trialStarted(o: { userId: string; orgId?: string }): void {
    tracki().identify(o.userId);
    emit("trial_started", o);
  },
  /** First-party conversion. */
  signupCompleted(o: { userId: string; orgId?: string }): void {
    tracki().identify(o.userId);
    emit("signup_completed", o);
  },

  // platform choice + connection ----------------------------------------------
  platformSelected(platform: Platform): void {
    platformInterest = platformInterest === "unknown" ? platform : platformInterest === platform ? platform : "both";
    emit("platform_selected", { platform });
  },
  zidSelected(): void {
    platformInterest = platformInterest === "salla" ? "both" : "zid";
    emit("zid_selected", { platform: "zid" });
  },
  sallaSelected(): void {
    platformInterest = platformInterest === "zid" ? "both" : "salla";
    emit("salla_selected", { platform: "salla" });
  },
  oauthStarted(platform: Platform): void {
    emit("oauth_started", { platform });
  },
  /** errorCode is a CODE (e.g. "access_denied"), never a raw provider message. */
  oauthFailed(o: { platform?: Platform; errorCode?: string }): void {
    emit("oauth_failed", { platform: o.platform, errorCode: o.errorCode });
  },
  storeConnected(o: { platform: Platform; storeId?: string; orgId?: string }): void {
    emit("store_connected", { platform: o.platform, storeId: o.storeId, orgId: o.orgId });
  },

  // activation + revenue ------------------------------------------------------
  firstSyncCompleted(o: { storeId: string } = { storeId: "" }): void {
    emit("first_sync_completed", { storeId: o.storeId || undefined });
  },
  firstProfitReportViewed(o: { storeId?: string } = {}): void {
    emit("first_profit_report_viewed", { storeId: o.storeId });
  },
  subscriptionStarted(o: { plan?: string; currency?: string } = {}): void {
    emit("subscription_started", o);
  },
  subscriptionCancelled(o: { reason?: string } = {}): void {
    emit("subscription_cancelled", o);
  },
};

export default VertexAnalytics;
