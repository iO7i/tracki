import { z } from "zod";

/**
 * Canonical behavioral-event contract shared across the snippet (types only,
 * erased at build), the ingest service (runtime validation), and the dashboard.
 */

export const EVENT_TYPES = [
  "pageview",
  "click",
  "form_focus",
  "form_submit",
  "form_abandon",
  "error",
  "route_change",
  "page_leave",
  "identify",
  "track",
  // Action tracking (implementation) — emitted by the snippet, carry {action_id, variant}.
  "action_impression",
  "action_click",
  "action_dismiss",
  "action_goal",
  // FAQ tracking (implementation) — carry {article_id?, query?}.
  "faq_view",
  "faq_search",
  "faq_search_noresult",
  "faq_vote_up",
  "faq_vote_down",
  // Live Assist tracking (implementation) — carry {action_id, article_id?, mode}.
  "assist_shown",
  "assist_helpful",
  "assist_unhelpful",
  "assist_escalate",
  // Mobile behavioral events (implementation) — emitted by the mobile SDKs. Screens
  // map onto `path` ("/" + screen name) so every path-keyed query (struggles,
  // HIGH_INTENT_PATTERN, revenue-by-path) works unchanged on mobile.
  "screen_view",
  "screen_leave", // props.durationMs
  "app_foreground", // props.launch: "cold" | "warm"
  "app_background",
  "app_terminate",
  "deep_link", // props.url, props.ok
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
  // Named funnels: props.flow ∈ checkout|registration|loan|kyc|onboarding|custom.
  "flow_start",
  "flow_complete",
  "flow_abandon",
  "permission_denied", // props.permission
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Mobile-only event types (implementation) — subset of EVENT_TYPES. */
export const MOBILE_EVENT_TYPES = [
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
] as const satisfies readonly EventType[];

/** Well-known funnel names for flow_* events; anything else is "custom". */
export const FLOW_NAMES = ["checkout", "registration", "loan", "kyc", "onboarding"] as const;
export type FlowName = (typeof FLOW_NAMES)[number];

/**
 * Behavioral events = real visitor activity (Audit 00-04 S1). Excludes the
 * product's own widget telemetry (action_* / faq_*) so the "events" volume
 * metric reflects behavior, not Tracki's internal interactions.
 */
export const BEHAVIORAL_EVENT_TYPES = [
  "pageview",
  "click",
  "form_focus",
  "form_submit",
  "form_abandon",
  "error",
  "route_change",
  "page_leave",
  "identify",
  "track",
  // implementation: mobile activity is visitor behavior too.
  ...MOBILE_EVENT_TYPES,
] as const;

// Caps to bound payload size and storage (and to blunt abusive clients).
const MAX_EVENTS_PER_BATCH = 50;
const MAX_STR = 2048;
const MAX_PROPS_BYTES = 8192;

const shortStr = z.string().max(MAX_STR);

/** A single event as emitted by the snippet. */
export const eventInputSchema = z.object({
  eventId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  type: z.enum(EVENT_TYPES),
  // Client timestamp (ms since epoch). Server also stamps received_at.
  ts: z.number().int().positive(),
  path: shortStr.optional(),
  url: shortStr.optional(),
  referrer: shortStr.optional(),
  // Free-form, JSON-serializable; size-bounded after stringify.
  props: z
    .record(z.unknown())
    .optional()
    .refine(
      (p) => p === undefined || JSON.stringify(p).length <= MAX_PROPS_BYTES,
      "errors.propsTooLarge",
    ),
});
export type EventInput = z.infer<typeof eventInputSchema>;

/** Where a batch originated. Web snippet omits `device` ⇒ platform "web". */
export const DEVICE_PLATFORMS = ["ios", "android", "web"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const SDK_FLAVORS = ["react-native", "flutter", "ios", "android", "web"] as const;
export type SdkFlavor = (typeof SDK_FLAVORS)[number];

/**
 * Optional batch-level device context (implementation). Sent once per batch by the
 * mobile SDKs; stamped onto every stored event so revenue/recovery can be cut
 * by app version and device type.
 */
export const deviceContextSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  osVersion: z.string().max(32).optional(),
  appVersion: z.string().max(32).optional(),
  model: z.string().max(64).optional(),
  sdk: z.enum(SDK_FLAVORS).optional(),
});
export type DeviceContext = z.infer<typeof deviceContextSchema>;

/** The batch envelope POSTed to `/v1/events`. */
export const eventBatchSchema = z.object({
  // Project public key (pk_…) — resolved server-side to org/project.
  key: z.string().min(3).max(64),
  anonId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  userId: z.string().min(1).max(128).optional(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  sentAt: z.number().int().positive(),
  // implementation: mobile SDKs describe their runtime; absent ⇒ web.
  device: deviceContextSchema.optional(),
  events: z.array(eventInputSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;

/** A resolved project public key. */
export interface ProjectRef {
  projectId: string;
  orgId: string;
}

/** Normalized event ready for ClickHouse insertion. */
export interface StoredEvent {
  org_id: string;
  project_id: string;
  anon_id: string;
  user_id: string;
  session_id: string;
  event_id: string;
  type: EventType;
  path: string;
  url: string;
  referrer: string;
  props: string;
  ua: string;
  // implementation: device context, denormalized per row ('' / 'web' for browsers).
  platform: string;
  app_version: string;
  device_model: string;
  ts: number;
  received_at: number;
}
