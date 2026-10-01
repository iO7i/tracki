/** Native telemetry contract. Pure JS; no DOM, text/input, screenshots, or network bodies. */
export type CapturePolicy = { diagnostics: boolean; activity: boolean };
export type NativeBuild = { buildId?: string; runtimeVersion?: string; updateId?: string };
export type MobileDiagnosticEvent = {
  eventId?: string;
  type: string;
  ts: number;
  path?: string;
  props?: Record<string, unknown>;
  traceContext?: { traceId: string; spanId: string; parentSpanId?: string };
};
const events = new Set([
  "error",
  "identify",
  "track",
  "screen_view",
  "screen_leave",
  "app_foreground",
  "app_background",
  "app_terminate",
  "deep_link",
  "push_open",
  "back_nav",
  "otp_start",
  "otp_fail",
  "otp_success",
  "biometric_start",
  "biometric_fail",
  "biometric_success",
  "payment_start",
  "payment_fail",
  "payment_complete",
  "flow_start",
  "flow_complete",
  "flow_abandon",
  "permission_denied",
  "action_impression",
  "action_click",
  "action_dismiss",
  "action_goal",
  "faq_view",
  "faq_search",
  "faq_search_noresult",
  "faq_vote_up",
  "faq_vote_down",
  "assist_shown",
  "assist_helpful",
  "assist_unhelpful",
  "assist_escalate",
]);
const diagnosticNames = new Set([
  "cco_request",
  "cco_response",
  "cco_network_failure",
  "native_crash",
]);
const trackNames = new Set([
  ...diagnosticNames,
  "custom_event",
  "purchase",
  "signup_completed",
  "platform_selected",
  "oauth_started",
  "oauth_failed",
  "store_connected",
  "first_sync_completed",
  "subscription_started",
  "onboarding_completed",
]);
const screens = new Set(
  "api v1 v2 app native home screens dashboard settings products product images links technical seo reviews loyalty matrix refer recur social signals reports report orders order customers customer connections session auth identity login logout callback bootstrap events cco health ready metrics billing checkout checkout-screen cart search plans subscriptions support notifications widgets store stores me account accounts organizations members usage invoices payments webhooks internal public context installations execute invoke completion onboarding registration loan kyc payment permissions faq".split(
    " ",
  ),
);
const codes = new Set(["CLIENT_ERROR", "JS_ERROR", "JS_FATAL", "NATIVE_CRASH", "NETWORK_FAILURE"]);
const valueSets: Record<string, Set<string>> = {
  launch: new Set(["cold", "warm"]),
  variant: new Set(["A", "B"]),
  mode: new Set(["answer", "fallback"]),
  channel: new Set(["url", "faq", "chat", "whatsapp"]),
  flow: new Set(["checkout", "registration", "loan", "kyc", "onboarding", "custom"]),
  permission: new Set([
    "camera",
    "microphone",
    "notifications",
    "location",
    "photos",
    "contacts",
    "biometrics",
    "other",
  ]),
  method: new Set([
    "mada",
    "visa",
    "mastercard",
    "apple_pay",
    "google_pay",
    "cash",
    "bank_transfer",
    "other",
  ]),
};
/** Route templates only: drop query/fragment, names/IDs and arbitrary screen labels. */
export function safeNativeRoute(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "/:screen";
  let path: string;
  try {
    path = new URL(value, "https://redacted.invalid").pathname;
  } catch {
    return "/:screen";
  }
  return (
    path
      .split("/")
      .slice(0, 12)
      .map((part) => {
        let name: string;
        try {
          name = decodeURIComponent(part).toLowerCase();
        } catch {
          return ":id";
        }
        return !name ? "" : screens.has(name) ? name : ":id";
      })
      .join("/")
      .slice(0, 240) || "/"
  );
}
export function isMobileDiagnostic(event: {
  type: string;
  props?: Record<string, unknown>;
}): boolean {
  return (
    event.type === "error" ||
    (event.type === "track" &&
      typeof event.props?.name === "string" &&
      diagnosticNames.has(event.props.name))
  );
}
export function capturePolicy(value: unknown): CapturePolicy {
  const p = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { diagnostics: p.diagnostics === true, activity: p.activity === true };
}
export function nativeBuild(value: unknown): NativeBuild {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const result: NativeBuild = {};
  for (const key of ["buildId", "runtimeVersion", "updateId"] as const) {
    const v = raw[key];
    if (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v)) result[key] = v;
  }
  return result;
}
/** Both client enqueue and authenticated collector apply the SAME allowlist. Unknown fields disappear. */
export function sanitizeMobileEvent(event: MobileDiagnosticEvent): MobileDiagnosticEvent | null {
  if (!events.has(event.type) || !Number.isSafeInteger(event.ts) || event.ts <= 0) return null;
  const raw = event.props ?? {};
  const props: Record<string, unknown> = {};
  if (event.type === "track")
    props.name =
      typeof raw.name === "string" && trackNames.has(raw.name) ? raw.name : "custom_event";
  if (event.type === "error")
    props.code = typeof raw.code === "string" && codes.has(raw.code) ? raw.code : "CLIENT_ERROR";
  for (const [key, allowed] of Object.entries(valueSets)) {
    if (typeof raw[key] === "string")
      props[key] = allowed.has(raw[key] as string)
        ? raw[key]
        : ["flow", "permission", "method"].includes(key)
          ? key === "flow"
            ? "custom"
            : "other"
          : undefined;
  }
  for (const key of ["durationMs", "statusCode", "count"] as const) {
    const value = raw[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= (key === "durationMs" ? 86400000 : key === "statusCode" ? 599 : 1000000) &&
      (key !== "statusCode" || value >= 100)
    )
      props[key] = value;
  }
  if (typeof raw.ok === "boolean") props.ok = raw.ok;
  // IDs refer to authored Tracki objects, not form contents or DOM/native labels.
  for (const key of ["action_id", "article_id"] as const) {
    if (typeof raw[key] === "string" && /^[a-f0-9-]{8,64}$/i.test(raw[key] as string))
      props[key] = raw[key];
  }
  const result: MobileDiagnosticEvent = {
    type: event.type,
    ts: event.ts,
    path: safeNativeRoute(event.path),
    props,
  };
  if (typeof event.eventId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(event.eventId))
    result.eventId = event.eventId;
  const trace = event.traceContext;
  const hex = (v: unknown, length: number) =>
    typeof v === "string" && new RegExp(`^(?!0+$)[a-f0-9]{${length}}$`).test(v);
  if (trace && hex(trace.traceId, 32) && hex(trace.spanId, 16)) {
    result.traceContext = {
      traceId: trace.traceId,
      spanId: trace.spanId,
      ...(hex(trace.parentSpanId, 16) ? { parentSpanId: trace.parentSpanId } : {}),
    };
  }
  return result;
}
