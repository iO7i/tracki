import { z } from "zod";
import { STRUGGLE_TYPES } from "./struggles";

// Slice 14: tour (guided steps) + drawer (contextual help) are mobile-only —
// the web snippet has no renderer for them (enforced in the schema below).
export const ACTION_TYPES = ["popup", "banner", "tooltip", "tour", "drawer"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Where an action renders (slice 14). Default "all"; tour/drawer force "mobile". */
export const ACTION_SURFACES = ["all", "web", "mobile"] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];

const MOBILE_ONLY_TYPES: readonly ActionType[] = ["tour", "drawer"];

export const ACTION_TRIGGERS = [
  "pageview",
  "time_on_page",
  "exit_intent",
  "rage_click",
  "event",
  // Slice 5: server-driven Live Assist on a detected struggle.
  "struggle",
] as const;
export type ActionTrigger = (typeof ACTION_TRIGGERS)[number];

export const ACTION_STATUSES = ["draft", "live"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Tracking events emitted by the snippet for actions (flow through the pipeline). */
export const ACTION_EVENT_TYPES = [
  "action_impression",
  "action_click",
  "action_dismiss",
  "action_goal",
] as const;

const text = z.string().max(500);

// Slice 12: "right channeling" — a CTA routes to a channel, not just a URL.
export const CTA_KINDS = ["url", "faq", "chat", "whatsapp"] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

const ctaObjectSchema = z
  .object({
    label: z.string().min(1).max(80),
    // Slice 12: explicit channel. Optional for back-compat — see resolveCtaKind.
    kind: z.enum(CTA_KINDS).optional(),
    // http(s) only — rendered as an anchor on visitor browsers (XSS guard).
    url: z
      .string()
      .url()
      .max(2048)
      .refine((u) => /^https?:\/\//i.test(u), "errors.invalidUrl")
      .optional(),
    // Slice 4 (legacy): open the FAQ widget instead of navigating.
    faq: z.boolean().optional(),
  })
  .refine(
    // A url CTA (explicit or implied) must carry a URL; widget channels need only a label.
    (c) => (c.kind ?? (c.faq ? "faq" : "url")) !== "url" || !!c.url,
    "errors.required",
  );
export type ActionCta = z.infer<typeof ctaObjectSchema>;
const ctaSchema = ctaObjectSchema.optional();

/**
 * Effective channel of a CTA, tolerating pre-slice-12 definitions
 * (`faq: true` or url-only, with no `kind`).
 */
export function resolveCtaKind(cta: { kind?: CtaKind; faq?: boolean; url?: string }): CtaKind {
  if (cta.kind) return cta.kind;
  if (cta.faq) return "faq";
  return "url";
}

const localizedSchema = z.object({
  title: text,
  body: text,
  cta: ctaSchema,
});
export type LocalizedContent = z.infer<typeof localizedSchema>;

const contentSchema = z.object({
  ar: localizedSchema,
  en: localizedSchema,
});

const triggerSchema = z.object({
  kind: z.enum(ACTION_TRIGGERS),
  seconds: z.number().int().min(1).max(3600).optional(),
  eventName: z.string().min(1).max(80).optional(),
});

// Slice 14: guided-tour steps — bilingual, optionally anchored to a screen/element key.
const tourStepSchema = z.object({
  ar: z.object({ title: text, body: text }),
  en: z.object({ title: text, body: text }),
  anchor: z.string().max(200).optional(),
});
export type TourStep = z.infer<typeof tourStepSchema>;

export const actionDefinitionSchema = z
  .object({
    type: z.enum(ACTION_TYPES),
    content: contentSchema,
    contentB: contentSchema.optional(), // A/B variant
    trigger: triggerSchema,
    urlContains: z.string().max(400).optional(),
    frequencyCap: z.number().int().min(1).max(100).optional(),
    goalEvent: z.string().min(1).max(80).optional(),
    anchorSelector: z.string().max(200).optional(),
    // Slice 14 — render surface; absent (pre-slice-14 definitions) ⇒ "all".
    surface: z.enum(ACTION_SURFACES).optional(),
    // Slice 14 — guided tour steps (type="tour" only).
    steps: z.array(tourStepSchema).min(1).max(10).optional(),
    // Slice 5 — Live Assist (server-driven, trigger="struggle"):
    struggleTypes: z.array(z.enum(STRUGGLE_TYPES)).max(15).optional(),
    // Slice 5 (S2) — deliver only to visitors matching this saved segment.
    segmentId: z.string().uuid().optional(),
    schedule: z
      .object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional(),
      })
      .optional(),
  })
  // The web snippet has no tour/drawer renderer — keep them off web manifests.
  .refine((d) => !MOBILE_ONLY_TYPES.includes(d.type) || resolveSurface(d) === "mobile", {
    message: "errors.mobileOnlyType",
    path: ["surface"],
  })
  .refine((d) => d.type !== "tour" || (d.steps?.length ?? 0) >= 1, {
    message: "errors.required",
    path: ["steps"],
  });
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;

/** Effective render surface, tolerating pre-slice-14 definitions (no `surface`). */
export function resolveSurface(d: { surface?: ActionSurface }): ActionSurface {
  return d.surface ?? "all";
}

/** True if an action belongs on the given SDK surface ("all" matches both). */
export function surfaceMatches(d: { surface?: ActionSurface }, surface: "web" | "mobile"): boolean {
  const s = resolveSurface(d);
  return s === "all" || s === surface;
}

export const createActionSchema = z.object({
  name: z.string().trim().min(2, "errors.nameTooShort").max(80, "errors.tooLong"),
  status: z.enum(ACTION_STATUSES),
  definition: actionDefinitionSchema,
});
export type CreateActionInput = z.infer<typeof createActionSchema>;

/** The client-facing action shape served in the manifest (id + definition). */
export interface ActionManifestEntry extends ActionDefinition {
  id: string;
}

/** Live Assist payload returned in the /v1/events response (slice 5). */
export interface AssistContent {
  title: string;
  body: string;
  // Audit 12 M2: `kind` flows through at runtime (slice-12 channel CTAs on Live
  // Assist actions); declare it so the compiler enforces the serialization path.
  cta?: { label: string; url?: string; faq?: boolean; kind?: CtaKind };
}
export interface AssistPayload {
  actionId: string;
  mode: "answer" | "fallback";
  confidence: number;
  /** Action-authored content: the fallback message + escalate CTA, both locales. */
  content: { ar: AssistContent; en: AssistContent };
  /** Answer mode: the contextually-matched FAQ, both locales. */
  article?: { ar: { title: string; body: string }; en: { title: string; body: string } };
  articleId?: string;
}

/**
 * Screens covered by live actions on the MOBILE surface (slice-14 audit M1+M3).
 * Returns substring targets; "*" = everything. Rules:
 * - Web-only actions cover nothing on mobile (the manifest never delivers them).
 * - Only a struggle-trigger (Live Assist) action with no urlContains covers all
 *   screens — it actually intervenes wherever friction is detected. A pageview/
 *   event action with no urlContains shows everywhere but is presence, not
 *   intervention, so it must NOT blanket-suppress the opportunities panel.
 * - Any mobile-reachable action with urlContains covers the matching screens.
 */
export function mobileCoverageTargets(
  defs: Array<{ surface?: ActionSurface; urlContains?: string; trigger?: { kind?: string } }>,
): string[] {
  const targets: string[] = [];
  for (const d of defs) {
    if (!surfaceMatches(d, "mobile")) continue;
    if (d.urlContains) {
      targets.push(d.urlContains);
    } else if (d.trigger?.kind === "struggle") {
      return ["*"];
    }
  }
  return targets;
}

/** Stable per-visitor A/B assignment: 'A' or 'B'. */
export function pickVariant(anonId: string, actionId: string, hasB: boolean): "A" | "B" {
  if (!hasB) return "A";
  let h = 0;
  const s = `${anonId}:${actionId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? "A" : "B";
}

/** True if `now` is within an action's schedule (used by the manifest filter). */
export function isInSchedule(schedule: ActionDefinition["schedule"], now: number): boolean {
  if (!schedule) return true;
  if (schedule.start && now < Date.parse(schedule.start)) return false;
  if (schedule.end && now > Date.parse(schedule.end)) return false;
  return true;
}

// --- Slice 12: Autopilot action proposals ---

/**
 * Why Autopilot proposed an action — masked/aggregate data only (paths are
 * PII-masked at ingest; element is a tag|id|class signature, never content).
 */
export interface ActionProposalEvidence {
  path: string;
  struggleType: string;
  /** Struggle occurrences behind this seed (window: last 30 days). */
  count: number;
  /** Summed 0–100 friction score for the path (slice 11). */
  score: number;
  /** Dominant element signature, when the struggle is element-bound. */
  element?: string;
  /** Dominant platform of the friction ('web' | 'ios' | 'android') — audit 00-14 M2. */
  platform?: string;
  /** A published FAQ that grounds the faq CTA suggestion, if one matched. */
  articleId?: string;
  /** A recurring VoC gap question that reinforced this seed, if any. */
  gapQuestion?: string;
}

/** A proposal's draft is a ready-to-edit action: name + full definition. */
export const actionProposalDraftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  definition: actionDefinitionSchema,
});
export type ActionProposalDraft = z.infer<typeof actionProposalDraftSchema>;

export const ACTION_PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ActionProposalStatus = (typeof ACTION_PROPOSAL_STATUSES)[number];

/** Stable dedup key so regeneration never duplicates a seen seed (slice-9 pattern). */
export function proposalSeedKey(path: string, struggleType: string): string {
  return `${path}|${struggleType}`;
}
