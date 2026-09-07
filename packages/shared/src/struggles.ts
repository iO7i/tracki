import { z } from "zod";

/** Detected stuck-states (slice 2 + rich detection slice 11 + mobile slice 14). */
export const STRUGGLE_TYPES = [
  "rage_click",
  "dead_click",
  "repeated_error",
  "repeated_submit",
  "form_abandon",
  "thrashing",
  // Mobile (slice 14) — detected from mobile SDK events by the same engine.
  "repeated_payment_failure",
  "otp_failure_loop",
  "biometric_failure_loop",
  "app_restart_loop",
  "deep_link_failure",
  "onboarding_abandonment",
  "permission_denial_loop",
  "repeated_back_navigation",
  "rapid_screen_switching",
] as const;
export type StruggleType = (typeof STRUGGLE_TYPES)[number];

/** Mobile-only struggle types (slice 14) — subset of STRUGGLE_TYPES. */
export const MOBILE_STRUGGLE_TYPES = [
  "repeated_payment_failure",
  "otp_failure_loop",
  "biometric_failure_loop",
  "app_restart_loop",
  "deep_link_failure",
  "onboarding_abandonment",
  "permission_denial_loop",
  "repeated_back_navigation",
  "rapid_screen_switching",
] as const satisfies readonly StruggleType[];

export const STRUGGLE_SEVERITIES = ["low", "medium", "high"] as const;
export type StruggleSeverity = (typeof STRUGGLE_SEVERITIES)[number];

/**
 * Per-type base weight for the 0–100 severity score (slice 11). A frequency
 * bonus is added on top. Tuned so a fought form / repeated errors rank above a
 * single abandon, which ranks above generic thrashing.
 */
export const STRUGGLE_WEIGHTS: Record<StruggleType, number> = {
  repeated_error: 70,
  repeated_submit: 65,
  form_abandon: 45,
  dead_click: 40,
  rage_click: 35,
  thrashing: 25,
  // Mobile (slice 14). Money- and auth-blocking loops rank highest: a user who
  // can't pay or can't get in is the most expensive friction in the app.
  repeated_payment_failure: 80,
  otp_failure_loop: 75,
  biometric_failure_loop: 70,
  app_restart_loop: 60,
  deep_link_failure: 50,
  onboarding_abandonment: 45,
  permission_denial_loop: 40,
  repeated_back_navigation: 35,
  rapid_screen_switching: 25,
};

/**
 * High-intent paths — a struggle on checkout/payment hurts more than on /about.
 * Used by the detector's score bonus (slice 11), Autopilot's channel suggestion
 * (slice 12), and Revenue Impact (slice 13). The pattern is single-sourced so
 * the JS regex and the ClickHouse `match()` string can't drift apart.
 */
export const HIGH_INTENT_PATTERN =
  "checkout|\\bcart\\b|payment|billing|\\bpay\\b|pricing|booking|signup";
export const HIGH_INTENT_PATH = new RegExp(HIGH_INTENT_PATTERN, "i");

/**
 * Struggle types that put revenue at risk REGARDLESS of screen/path name
 * (slice 14): a repeated payment failure is money friction even when the
 * mobile screen isn't named "checkout". Single-sourced so the revenue queries
 * and any UI copy can't drift. Deliberately conservative — OTP/biometric loops
 * also gate logins, so they stay path-dependent like every other type.
 */
export const MONEY_STRUGGLE_TYPES = [
  "repeated_payment_failure",
] as const satisfies readonly StruggleType[];

/** Clamp a raw score to 0–100 and round (UInt16-safe). */
export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Derive the coarse severity badge from the numeric score. */
export function severityFromScore(score: number): StruggleSeverity {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/**
 * Human, FAQ-vocabulary intent words for a struggle type — bilingual (en + ar)
 * so they can lexically overlap real help articles. Used as a GROUNDING SIGNAL
 * for contextual FAQ matching (slice 5): the raw type token (`otp_failure_loop`)
 * never appears in an FAQ, but "otp code رمز التحقق" does. Types with no clear
 * self-service intent (rage/dead click, thrashing, restart, back-nav) return ""
 * so they add no noise.
 */
const STRUGGLE_INTENT: Partial<Record<StruggleType, string>> = {
  repeated_error: "error problem خطأ مشكلة",
  repeated_submit: "form submit نموذج إرسال",
  form_abandon: "form submit نموذج إرسال",
  repeated_payment_failure: "payment pay card checkout دفع بطاقة سداد",
  otp_failure_loop: "otp code verification رمز التحقق",
  biometric_failure_loop: "biometric login fingerprint بصمة تسجيل الدخول",
  deep_link_failure: "link رابط",
  onboarding_abandonment: "onboarding signup register account تسجيل حساب",
  permission_denial_loop: "permission access إذن صلاحية",
};

export function struggleIntentTokens(type: string): string {
  return STRUGGLE_INTENT[type as StruggleType] ?? "";
}

/** A struggle row, ready for ClickHouse + the live channel. */
export interface StruggleDetection {
  org_id: string;
  project_id: string;
  anon_id: string;
  user_id: string;
  session_id: string;
  struggle_id: string;
  type: StruggleType;
  severity: StruggleSeverity;
  path: string;
  /** Element signature (tag|id|class) for click/submit/abandon; "" otherwise. */
  element: string;
  reason: string;
  event_count: number;
  /** 0–100 friction score; `severity` is derived from it. */
  score: number;
  /** Device context of the triggering event (slice 14); '' for web rows. */
  platform: string;
  app_version: string;
  ts: number;
}

/**
 * Segment condition kinds (v1). ANDed together. Kept small and typed so segment
 * evaluation can map each to a parameterized query — never string-built SQL.
 */
export const segmentConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("struggle"),
    struggleType: z.enum(STRUGGLE_TYPES),
  }),
  z.object({
    kind: z.literal("event"),
    eventType: z.string().min(1).max(40),
    pathContains: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("identified"),
    value: z.boolean(),
  }),
]);
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export const segmentDefinitionSchema = z.object({
  conditions: z.array(segmentConditionSchema).min(1).max(10),
});
export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

export const createSegmentSchema = z.object({
  name: z.string().trim().min(2, "errors.nameTooShort").max(80, "errors.tooLong"),
  definition: segmentDefinitionSchema,
});
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
